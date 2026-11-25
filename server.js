const express = require("express");
const multer = require("multer");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Gemini 설정
const API_KEY = process.env.GEMINI_API_KEY;
const FREE_MODEL = process.env.GEMINI_FREE_MODEL || "gemini-3.8-flash";
const PREMIUM_MODEL = process.env.GEMINI_PREMIUM_MODEL || "gemini-2.5-pro";

// 토스페이먼츠 시크릿 키 (Render Environment에 TOSS_SECRET_KEY 등록)
const TOSS_SECRET_KEY = process.env.TOSS_SECRET_KEY || "";
const PREMIUM_PRICE_KRW = 4900;

// 파일 업로드 설정
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024
  }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 웹사이트 파일 제공
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// 잠시 기다리기
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 임시 회원/결제 저장소 (실서비스 운영 시 Firestore/Supabase로 교체 권장)
const usersDb = new Map();
const processedOrders = new Set();

// 요청에서 사용자 정보 추출 (구글 로그인만 premium 가능, 게스트는 무조건 free 고정)
function getRequestUser(req) {
  const provider =
    req.body?.provider === "google" || req.headers["x-auth-provider"] === "google"
      ? "google"
      : "guest";

  const userId =
    (req.body?.userId || req.headers["x-user-id"] || "").toString().trim() ||
    "guest_default";

  if (provider !== "google" || userId === "guest_default") {
    return {
      id: userId,
      provider: "guest",
      plan: "free",
      premiumExpiresAt: null
    };
  }

  const saved = usersDb.get(userId);
  return {
    id: userId,
    provider: "google",
    plan: saved?.plan === "premium" ? "premium" : "free",
    premiumExpiresAt: saved?.premiumExpiresAt || null
  };
}

// 실제 적용할 등급 판별
function resolveEffectivePlan(user) {
  if (!user || user.provider !== "google") {
    return "free";
  }

  if (user.plan !== "premium") {
    return "free";
  }

  if (user.premiumExpiresAt) {
    const expiresTime = new Date(user.premiumExpiresAt).getTime();
    if (Number.isNaN(expiresTime) || expiresTime <= Date.now()) {
      return "free";
    }
  }

  return "premium";
}

// 등급별 Gemini 모델 및 프롬프트 설정
function getGeminiSettings(plan) {
  if (plan === "premium") {
    return {
      model: PREMIUM_MODEL,
      maxOutputTokens: 2048,
      systemInstructionText:
        "너는 Chet Buddy Premium(월 4,900원) AI 챗봇이다. " +
        "더 깊고 정확하며 구조화된 답변을 빠르고 똑똑하게 제공한다. " +
        "중요한 문제에서는 단계별로 신중하게 분석하고, 일반 대화에서는 자연스럽고 친근하게 답한다. " +
        "모든 연령이 이해할 수 있도록 친절하고 안전하게 한국어로 답한다."
    };
  }

  return {
    model: FREE_MODEL,
    maxOutputTokens: 768,
    systemInstructionText:
      "너는 Chat Buddy라는 AI 챗봇이다. " +
      "평범한 대화에서는 자연스럽고 친근하게 답한다. " +
      "중요한 문제에서는 진지하고 신중하게 답한다. " +
      "모든 연령이 이해할 수 있도록 친절하고 안전하게 답한다. " +
      "사용자에게는 기본적으로 한국어로 답한다. " +
      "질문과 관련 있는 내용을 정확하고 이해하기 쉽게 설명한다."
  };
}

// Gemini 요청: 최대 3회 재시도
async function askGemini(body, modelName = FREE_MODEL) {
  const retryStatuses = [429, 500, 502, 503, 504];

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${API_KEY}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        }
      );

      const data = await response.json();

      if (response.ok) {
        return data;
      }

      console.error(`Gemini 오류 (${attempt}/3):`, data);

      if (!retryStatuses.includes(response.status) || attempt === 3) {
        const error = new Error(
          data.error?.message || "Gemini API 요청 중 오류가 발생했습니다."
        );
        error.status = response.status;
        throw error;
      }
    } catch (error) {
      if (error.status) {
        throw error;
      }

      console.error(`네트워크 오류 (${attempt}/3):`, error);

      if (attempt === 3) {
        throw error;
      }
    }

    await wait(attempt * 1000);
  }

  throw new Error("AI 서버가 응답하지 않습니다.");
}

// 사용자 현재 구독 상태 조회 API
app.get("/api/subscription/status", (req, res) => {
  const user = getRequestUser(req);
  const effectivePlan = resolveEffectivePlan(user);

  return res.json({
    provider: user.provider,
    plan: effectivePlan,
    premiumExpiresAt: effectivePlan === "premium" ? user.premiumExpiresAt : null
  });
});

// 토스페이먼츠 결제 승인 및 Chet Buddy Premium(4,900원) 활성화 API
app.post("/api/payments/toss/confirm", async (req, res) => {
  try {
    if (!TOSS_SECRET_KEY) {
      return res.status(500).json({
        error: "서버에 TOSS_SECRET_KEY 환경변수가 설정되지 않았습니다."
      });
    }

    const user = getRequestUser(req);
    if (user.provider !== "google" || !user.id || user.id === "guest_default") {
      return res.status(403).json({
        error: "Chet Buddy Premium은 구글 로그인 계정만 결제할 수 있습니다."
      });
    }

    const { paymentKey, orderId, amount } = req.body || {};
    const numericAmount = Number(amount);

    if (!paymentKey || !orderId || !numericAmount) {
      return res.status(400).json({
        error: "필수 결제 정보(paymentKey, orderId, amount)가 누락되었습니다."
      });
    }

    // 결제 금액 변조 검증 (반드시 4,900원이어야 함)
    if (numericAmount !== PREMIUM_PRICE_KRW) {
      return res.status(400).json({
        error: `결제 금액이 일치하지 않습니다. (요청 금액: ${numericAmount}원)`
      });
    }

    // 이미 처리된 주문 중복 요청 방지
    if (processedOrders.has(orderId)) {
      const existing = usersDb.get(user.id);
      return res.json({
        message: "이미 승인 완료된 결제입니다.",
        plan: existing?.plan || "premium",
        premiumExpiresAt: existing?.premiumExpiresAt || null
      });
    }

    // 토스페이먼츠 결제 승인 API 호출 (Basic 인증: secretKey + ":")
    const encryptedSecretKey =
      "Basic " + Buffer.from(`${TOSS_SECRET_KEY}:`).toString("base64");

    const tossResponse = await fetch(
      "https://api.tosspayments.com/v1/payments/confirm",
      {
        method: "POST",
        headers: {
          Authorization: encryptedSecretKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          paymentKey,
          orderId,
          amount: numericAmount
        })
      }
    );

    const tossData = await tossResponse.json();

    if (!tossResponse.ok || tossData.status !== "DONE") {
      console.error("토스페이먼츠 승인 실패:", tossData);
      return res.status(tossResponse.status || 400).json({
        error: tossData.message || "토스페이먼츠 결제 승인에 실패했습니다.",
        code: tossData.code || "TOSS_CONFIRM_FAILED"
      });
    }

    // 토스 응답 금액 재검증
    if (Number(tossData.totalAmount) !== PREMIUM_PRICE_KRW) {
      return res.status(400).json({
        error: "승인된 결제 금액이 4,900원과 일치하지 않습니다."
      });
    }

    processedOrders.add(orderId);

    const thirtyDaysLater = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000
    ).toISOString();

    usersDb.set(user.id, {
      id: user.id,
      provider: "google",
      plan: "premium",
      priceKrw: PREMIUM_PRICE_KRW,
      lastOrderId: orderId,
      lastPaymentKey: paymentKey,
      premiumExpiresAt: thirtyDaysLater
    });

    return res.json({
      message: "Chet Buddy Premium 결제가 완료되었습니다.",
      plan: "premium",
      premiumExpiresAt: thirtyDaysLater,
      orderName: tossData.orderName
    });
  } catch (error) {
    console.error("결제 승인 서버 오류:", error);
    return res.status(500).json({
      error: "결제 승인 처리 중 서버 오류가 발생했습니다."
    });
  }
});

// AI 채팅
app.post("/api/chat", upload.single("image"), async (req, res) => {
  try {
    if (!API_KEY) {
      return res.status(500).json({
        reply: "서버에 GEMINI_API_KEY가 설정되지 않았습니다."
      });
    }

    const message = (req.body.message || "").trim();

    if (!message && !req.file) {
      return res.status(400).json({
        reply: "메시지나 사진을 보내 주세요."
      });
    }

    const user = getRequestUser(req);
    const effectivePlan = resolveEffectivePlan(user);
    const settings = getGeminiSettings(effectivePlan);

    const parts = [];

    if (message) {
      parts.push({ text: message });
    }

    if (req.file) {
      parts.push({
        inlineData: {
          mimeType: req.file.mimetype,
          data: req.file.buffer.toString("base64")
        }
      });
    }

    const data = await askGemini(
      {
        contents: [
          {
            role: "user",
            parts
          }
        ],
        generationConfig: {
          maxOutputTokens: settings.maxOutputTokens
        },
        systemInstruction: {
          parts: [
            {
              text: settings.systemInstructionText
            }
          ]
        }
      },
      settings.model
    );

    const reply = data.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("")
      .trim();

    if (!reply) {
      return res.status(502).json({
        reply: "AI 답변을 받아오지 못했습니다. 다시 시도해 주세요."
      });
    }

    return res.json({
      reply,
      plan: effectivePlan,
      model: settings.model
    });
  } catch (error) {
    console.error("채팅 서버 오류:", error);

    return res.status(error.status || 500).json({
      reply:
        error.message ||
        "서버에서 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."
    });
  }
});

// 서버 실행
app.listen(PORT, () => {
  console.log(`Chat Buddy 서버 실행 중: ${PORT}`);
});
