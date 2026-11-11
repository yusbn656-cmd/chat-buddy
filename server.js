
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

// 서버 상태 확인
app.get("/api/chat", (req, res) => {
  res.json({
    status: "Chat Buddy server is running"
  });
});

// AI 요청 함수
async function requestAI(url, headers, body) {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 45000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const text = await response.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("AI 서버 응답을 읽을 수 없습니다.");
    }

    if (!response.ok) {
      const error = new Error(
        data.error?.message ||
        data.error ||
        "AI 요청에 실패했습니다."
      );

      error.status = response.status;
      throw error;
    }

    return data;

  } finally {
    clearTimeout(timeout);
  }
}

// Gemini 요청
async function askGemini(message) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("Gemini API 키가 없습니다.");
  }

  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent";

  const data = await requestAI(
    url,
    {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    {
      contents: [
        {
          parts: [
            { text: message }
          ]
        }
      ]
    }
  );

  const answer = data.candidates?.[0]?.content?.parts
    ?.map(part => part.text || "")
    .join("")
    .trim();

  if (!answer) {
    throw new Error("Gemini 답변이 비어 있습니다.");
  }

  return answer;
}

// Groq 요청
async function askGroq(message) {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    throw new Error("Groq API 키가 없습니다.");
  }

  const url =
    "https://api.groq.com/openai/v1/chat/completions";

  const data = await requestAI(
    url,
    {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    {
      model: "openai/gpt-oss-20b",
      messages: [
        {
          role: "system",
          content:
            "너는 Chat Buddy라는 친절한 AI 챗봇이야. 한국어로 자연스럽고 이해하기 쉽게 답변해."
        },
        {
          role: "user",
          content: message
        }
      ],
      max_completion_tokens: 2048
    }
  );

  const answer =
    data.choices?.[0]?.message?.content?.trim();

  if (!answer) {
    throw new Error("Groq 답변이 비어 있습니다.");
  }

  return answer;
}

// 채팅 API
app.post("/api/chat", async (req, res) => {
  const message = req.body?.message;

  if (
    typeof message !== "string" ||
    !message.trim()
  ) {
    return res.status(400).json({
      error: "메시지를 입력해 주세요."
    });
  }

  console.log("Chat Buddy 요청 도착");

  // 1. Gemini 먼저 시도
  if (process.env.GEMINI_API_KEY) {
    try {
      console.log("Gemini 사용 중...");

      const reply = await askGemini(message);

      console.log("Gemini 답변 성공");

      return res.json({
        reply,
        provider: "Gemini"
      });

    } catch (error) {
      console.log(
        "Gemini 실패:",
        error.status || "",
        error.message
      );
      console.log("Groq로 자동 전환합니다.");
    }
  }

  // 2. Gemini 실패 시 Groq 사용
  if (process.env.GROQ_API_KEY) {
    try {
      console.log("Groq 사용 중...");

      const reply = await askGroq(message);

      console.log("Groq 답변 성공");

      return res.json({
        reply,
        provider: "Groq"
      });

    } catch (error) {
      console.log(
        "Groq 실패:",
        error.status || "",
        error.message
      );

      return res.status(502).json({
        error:
          "Gemini와 Groq 모두 답변하지 못했습니다. 잠시 후 다시 시도해 주세요."
      });
    }
  }

  return res.status(503).json({
    error:
      "AI API 키가 설정되지 않았습니다. Render 환경변수를 확인해 주세요."
  });
});

// 서버 실행
app.listen(PORT, "0.0.0.0", () => {
  console.log(
    "Chat Buddy 서버 실행 중:",
    PORT
  );
});
