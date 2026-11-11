
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.use((req, res, next) => {
  console.log("요청:", req.method, req.url);
  next();
});

app.use(express.static(__dirname));

// 서버 연결 확인
app.get("/api/chat", (req, res) => {
  res.json({
    status: "Chat Buddy server is running"
  });
});

// AI 채팅
app.post("/api/chat", async (req, res) => {
  console.log("AI 채팅 요청 도착");

  const apiKey = process.env.GEMINI_API_KEY;
  const message = req.body?.message;

  if (!apiKey) {
    console.log("API 키가 없습니다.");
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

  let lastError = "AI 요청 실패";

  // 최대 3번 자동 재시도
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log("AI 요청 시도:", attempt);

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      45000
    );

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
              parts: [
                { text: message }
              ]
            }
          ]
        }),
        signal: controller.signal
      });

      const text = await response.text();
      let data;

      try {
        data = JSON.parse(text);
      } catch {
        lastError = "AI 서버에서 올바르지 않은 응답을 받았습니다.";
        console.log(lastError);
        return res.status(502).json({
          error: lastError
        });
      }

      if (!response.ok) {
        lastError =
          data.error?.message || "Gemini API 오류";

        console.log("Gemini 오류:", response.status, lastError);

        if (![429, 500, 502, 503, 504].includes(response.status)) {
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

        return res.status(503).json({
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
          error: "AI 답변이 비어 있습니다."
        });
      }

      console.log("AI 답변 성공");

      return res.json({
        reply: answer
      });

    } catch (error) {
      lastError =
        error.name === "AbortError"
          ? "AI 응답 시간이 초과되었습니다."
          : error.message;

      console.log("요청 실패:", lastError);

      if (attempt < 3) {
        await new Promise(resolve =>
          setTimeout(resolve, attempt * 2000)
        );
      }

    } finally {
      clearTimeout(timeout);
    }
  }

  return res.status(503).json({
    error: "3번 시도했지만 실패했습니다: " + lastError
  });
});

// 서버 실행
app.listen(PORT, "0.0.0.0", () => {
  console.log("Chat Buddy 서버 실행 중:", PORT);
});
