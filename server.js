
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

// 재시도 시간 읽기
function getRetryMessage(message) {
  const match = message.match(
    /Please retry in ([0-9hms. ]+)/i
  );

  if (!match) {
    return "잠시 후 다시 시도해 주세요.";
  }

  const time = match[1];
  const hours = time.match(/([\d.]+)h/);
  const minutes = time.match(/([\d.]+)m/);

  let result = [];

  if (hours) result.push(Math.ceil(Number(hours[1])) + "시간");
  if (minutes) result.push(Math.ceil(Number(minutes[1])) + "분");

  if (result.length === 0) {
    return "잠시 후 다시 시도해 주세요.";
  }

  return result.join(" ") + " 후 다시 시도해 주세요.";
}

// AI 채팅
app.post("/api/chat", async (req, res) => {
  console.log("AI 채팅 요청 도착");

  const apiKey = process.env.GEMINI_API_KEY;
  const message = req.body?.message;

  if (!apiKey) {
    return res.status(500).json({
      error: "서버에 Gemini API 키가 설정되지 않았습니다."
    });
  }

  if (!message || !message.trim()) {
    return res.status(400).json({
      error: "메시지를 입력해 주세요."
    });
  }

  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent";

  // 최대 3회 시도
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      45000
    );

    try {
      console.log("AI 요청 시도:", attempt);

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
          ]
        }),
        signal: controller.signal
      });

      const text = await response.text();
      let data;

      try {
        data = JSON.parse(text);
      } catch {
        return res.status(502).json({
          error: "AI 서버에서 올바르지 않은 응답을 받았습니다."
        });
      }

      if (!response.ok) {
        const errorMessage =
          data.error?.message || "AI 요청에 실패했습니다.";

        console.log("Gemini 오류:", response.status, errorMessage);

        // 사용량 초과: 재시도하지 않음
        if (response.status === 429) {
          const retryMessage = getRetryMessage(errorMessage);

          return res.status(429).json({
            error:
              "Gemini 무료 사용량을 초과했습니다. " +
              retryMessage
          });
        }

        // 일시적인 서버 오류만 재시도
        if ([500, 502, 503, 504].includes(response.status)) {
          if (attempt < 3) {
            await new Promise(resolve =>
              setTimeout(resolve, attempt * 2000)
            );
            continue;
          }
        }

        return res.status(response.status).json({
          error: errorMessage
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

      console.log("AI 답변 성공");

      return res.json({
        reply: answer
      });

    } catch (error) {
      console.log("요청 실패:", error.message);

      if (attempt === 3) {
        return res.status(503).json({
          error: "서버 연결에 실패했습니다. 잠시 후 다시 시도해 주세요."
        });
      }

      await new Promise(resolve =>
        setTimeout(resolve, attempt * 2000)
      );

    } finally {
      clearTimeout(timeout);
    }
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Chat Buddy 서버 실행 중:", PORT);
});
