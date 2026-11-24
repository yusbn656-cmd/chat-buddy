const express = require("express");
const multer = require("multer");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Gemini 설정
const API_KEY = process.env.GEMINI_API_KEY;
const FREE_MODEL = process.env.GEMINI_FREE_MODEL || "gemini-3.8-flash";
const PREMIUM_MODEL = process.env.GEMINI_PREMIUM_MODEL || "gemini-3.8-pro";

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

// 임시 회원 저장소 (실서비스에서는 Supabase/Firebase/DB로 교체 권장)
// key: userId (예: "google_123456789")
const usersDb = new Map();

// 요청에서 사용자 정보 추출 (실서비스에서는 세션/JWT/DB 조회로 교체)
function getRequestUser(req) {
  // 예: 프론트에서 헤더나 body로 넘기는 경우(임시 테스트용)
  const provider =
    req.body?.provider === "google" || req.headers["x-auth-provider"] === "google"
      ? "google"
      : "guest";

  const userId =
    (req.body?.userId || req.headers["x-user-id"] || "").toString().trim() ||
    "guest_default";

  // 게스트는 절대 DB 프리미엄 권한을 가지지 못하도록 강제
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

// 실제 적용할 등급 판별: 구글 로그인 + 유효한 프리미엄 만료일일 때만 'premium'
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

// 등급별 모델 및 옵션 설정
function getGeminiSettings(plan) {
  if (plan === "premium") {
    return {
      model: PREMIUM_MODEL,
      maxOutputTokens: 2048,
      systemInstructionText:
        "너는 쳇버디 프리미엄(월 4,900원) AI 챗봇이다. " +
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

    // 1초, 2초 순서로 대기
    await wait(attempt * 1000);
  }

  throw new Error("AI 서버가 응답하지 않습니다.");
}

// 구글 로그인 전용 쳇버디 프리미엄(4,900원/월) 활성화 예시 엔드포인트
// 실제 결제 연동 시 PG/결제사 검증 완료 후 호출하도록 연결
app.post("/api/premium/activate", (req, res) => {
  const user = getRequestUser(req);

  if (user.provider !== "google" || !user.id || user.id === "guest_default") {
    return res.status(403).json({
      error: "쳇버디 프리미엄(월 4,900원)은 구글 로그인 계정만 이용할 수 있습니다."
    });
  }

  const thirtyDaysLater = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  usersDb.set(user.id, {
    id: user.id,
    provider: "google",
    plan: "premium",
    priceKrw: 4900,
    premiumExpiresAt: thirtyDaysLater
  });

  return res.json({
    message: "쳇버디 프리미엄이 활성화되었습니다.",
    plan: "premium",
    premiumExpiresAt: thirtyDaysLater
  });
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

    // 사진 첨부
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
