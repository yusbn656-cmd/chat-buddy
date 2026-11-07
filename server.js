
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

app.post("/api/chat", async (req, res) => {
  try {
    const message = req.body.message;

    if (!message) {
      return res.status(400).json({
        error: "메시지를 입력해 주세요."
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "AI API 키가 아직 설정되지 않았습니다."
      });
    }

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: message }]
            }
          ]
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message || "AI 연결 오류"
      });
    }

    const answer =
      data.candidates?.[0]?.content?.parts?.[0]?.text;

    res.json({
      reply: answer || "답변을 받지 못했어요."
    });

  } catch (error) {
    res.status(500).json({
      error: "서버 오류가 발생했습니다."
    });
  }
});

app.listen(PORT, () => {
  console.log(`Chat Buddy running on port ${PORT}`);
});
