
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

// 서버 연결 확인
app.get("/api/chat", (req, res) => {
  res.json({ status: "Chat Buddy server is running" });
});

// Gemini AI 요청
app.post("/api/chat", async (req, res) => {
  try {
    const message = req.body?.message;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "GEMINI_API_KEY 환경변수를 확인해 주세요."
      });
    }

    if (!message || !message.trim()) {
      return res.status(400).json({
        error: "메시지를 입력해 주세요."
      });
    }

    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent";

    let lastError = "AI 요청에 실패했습니다.";

    // 최대 3회 시도
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(),
          45000
        );

        let response;

        try {
          response = await fetch(url, {
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
            }),
            signal: controller.signal
          });
        } finally {
          clearTimeout(timeout);
        }

        const data = await response.json();

        if (!response.ok) {
          lastError =
            data.error?.message || "Gemini API 오류";

          // 과부하 또는 일시적인 서버 오류만 재시도
          if (
            ![429, 500, 502, 503, 504].includes(response.status)
          ) {
            return res.status(response.status).json({
              error: lastError
            });
          }

          if (attempt < 3) {
            await new Promise(resolve =>
              setTimeout(resolve, attempt * 2000)
            );
            continue;
          }

          return res.status(response.status).json({
            error: lastError
          });
        }

        const answer =
          data.candidates?.[0]?.content?.parts
            ?.map(part => part.text || "")
            .join("")
            .trim();

        if (!answer) {
          return res.status(502).json({
            error: "AI 답변을 받지 못했습니다."
          });
        }

        return res.json({ reply: answer });

      } catch (error) {
        lastError = error.name === "AbortError"
          ? "AI 응답 시간이 초과되었습니다."
          : error.message;

        if (attempt < 3) {
          await new Promise(resolve =>
            setTimeout(resolve, attempt * 2000)
          );
        }
      }
    }

    return res.status(503).json({
      error: "3회 시도했지만 답변을 받지 못했습니다: " +
        lastError
    });

  } catch (error) {
    console.error("서버 오류:", error);

    return res.status(500).json({
      error: "서버 내부 오류가 발생했습니다."
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Chat Buddy 서버 실행 중: " + PORT);
});
