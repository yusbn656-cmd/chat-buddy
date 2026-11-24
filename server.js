
const express = require("express");
const multer = require("multer");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Gemini 설정
const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

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

// Gemini 요청: 최대 3회 재시도
async function askGemini(body) {
  const retryStatuses = [429, 500, 502, 503, 504];

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`,
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

    const data = await askGemini({
      contents: [
        {
          role: "user",
          parts
        }
      ],
      systemInstruction: {
        parts: [
          {
            text:
              "너는 Chat Buddy라는 AI 챗봇이다. " +
              "평범한 대화에서는 자연스럽고 친근하게 답한다. " +
              "중요한 문제에서는 진지하고 신중하게 답한다. " +
              "모든 연령이 이해할 수 있도록 친절하고 안전하게 답한다. " +
              "사용자에게는 기본적으로 한국어로 답한다. " +
              "질문과 관련 있는 내용을 정확하고 이해하기 쉽게 설명한다."
          }
        ]
      }
    });

    const reply = data.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("")
      .trim();

    if (!reply) {
      return res.status(502).json({
        reply: "AI 답변을 받아오지 못했습니다. 다시 시도해 주세요."
      });
    }

    return res.json({ reply });

  } catch (error) {
    console.error("채팅 서버 오류:", error);

    return res.status(error.status || 500).json({
      reply: error.message ||
        "서버에서 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."
    });
  }
});

// 서버 실행
app.listen(PORT, () => {
  console.log(`Chat Buddy 서버 실행 중: ${PORT}`);
});
