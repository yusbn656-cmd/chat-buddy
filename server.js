
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

app.post("/api/chat", async (req, res) => {
  try {
    const message = req.body.message;

    if (!message || !message.trim()) {
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

    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent";

    let data;
    let lastError = "";

    // 최초 요청 1회 + 재시도 최대 3회
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const response = await fetch(url, {
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
            ],
            generationConfig: {
              maxOutputTokens: 512,
              temperature: 0.7
            }
          })
        });

        const responseText = await response.text();

        try {
          data = JSON.parse(responseText);
        } catch {
          throw new Error("AI 서버에서 올바르지 않은 응답을 받았습니다.");
        }

        if (response.ok) {
          break;
        }

        lastError =
          data.error?.message || "AI 연결 오류";

        const retryable = [
          429, 500, 502, 503, 504
        ].includes(response.status);

        if (!retryable || attempt === 3) {
          return res.status(response.status).json({
            error: lastError
          });
        }

        const retryAfter =
          Number(response.headers.get("Retry-After"));

        const waitTime =
          Number.isFinite(retryAfter) &&
          retryAfter > 0
            ? Math.min(retryAfter * 1000, 8000)
            : 1000 * Math.pow(2, attempt);

        await sleep(waitTime);

      } catch (error) {
        lastError = error.message;

        if (attempt === 3) {
          return res.status(503).json({
            error: "AI 연결에 실패했습니다. 잠시 후 다시 시도해 주세요."
          });
        }

        await sleep(1000 * Math.pow(2, attempt));
      }
    }

    const answer =
      data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!answer) {
      return res.status(502).json({
        error: "AI 답변을 받지 못했어요."
      });
    }

    res.json({
      reply: answer
    });

  } catch (error) {
    console.error("서버 오류:", error);

    res.status(500).json({
      error: "서버 오류가 발생했습니다."
    });
  }
});

app.listen(PORT, () => {
  console.log("Chat Buddy running on port " + PORT);
});
