
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

// 기본 설정
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 웹사이트 파일 제공
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
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

    const parts = [];

    if (message) {
      parts.push({ text: message });
    }

    // 사진이 첨부된 경우
    if (req.file) {
      parts.push({
        inline_data: {
          mime_type: req.file.mimetype,
          data: req.file.buffer.toString("base64")
        }
      });
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: parts
            }
          ],
          system_instruction: {
            parts: [
              {
                text: "너는 Chat Buddy라는 AI 챗봇이다. 평범한 대화에서는 자연스럽고 유머 있게 답하고, 심각하거나 중요한 문제에서는 진지하고 신중하게 답한다. 모든 연령이 이해할 수 있도록 친절하고 안전하게 답한다. 사용자의 질문에 한국어로 답한다."
              }
            ]
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini API 오류:", data);

      return res.status(response.status).json({
        reply:
          data.error?.message ||
          "Gemini API 요청 중 오류가 발생했습니다."
      });
    }

    const reply =
      data.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("")
        .trim();

    if (!reply) {
      return res.status(500).json({
        reply: "AI 답변을 받아오지 못했습니다. 다시 시도해 주세요."
      });
    }

    res.json({ reply });

  } catch (error) {
    console.error("서버 오류:", error);

    res.status(500).json({
      reply: "서버에서 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."
    });
  }
});

// 서버 실행
app.listen(PORT, () => {
  console.log(`Chat Buddy 서버 실행 중: ${PORT}`);
});
