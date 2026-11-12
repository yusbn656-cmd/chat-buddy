
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

app.get("/api/chat", (req, res) => {
  res.json({ status: "Chat Buddy server is running" });
});

// 공통 AI 요청 함수
async function requestAI(url, headers, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

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

// 1번 AI: Gemini
async function askGemini(message) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Gemini 키 없음");

  const data = await requestAI(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
    {
      "Content-Type": "application/json",
      "x-goog-api-key": key
    },
    {
      contents: [{ parts: [{ text: message }] }]
    }
  );

  const answer = data.candidates?.[0]?.content?.parts
    ?.map(part => part.text || "")
    .join("")
    .trim();

  if (!answer) throw new Error("Gemini 답변 없음");
  return answer;
}

// 2번 AI: Groq
async function askGroq(message) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("Groq 키 없음");

  const data = await requestAI(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`
    },
    {
      model: "openai/gpt-oss-20b",
      messages: [
        {
          role: "system",
          content: "너는 Chat Buddy라는 친절한 AI야. 한국어로 쉽게 답변해."
        },
        { role: "user", content: message }
      ],
      max_completion_tokens: 2048
    }
  );

  const answer = data.choices?.[0]?.message?.content?.trim();
  if (!answer) throw new Error("Groq 답변 없음");
  return answer;
}

// 3번 AI: FreeTheAI
async function askFreeTheAI(message) {
  const key = process.env.FREETHEAI_API_KEY;
  if (!key) throw new Error("FreeTheAI 키 없음");

  const data = await requestAI(
    "https://api.freetheai.org/v1/chat/completions",
    {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`
    },
    {
      model: "fta/zai/glm-5.3-flash",
      messages: [
        {
          role: "system",
          content: "너는 Chat Buddy라는 친절한 AI야. 한국어로 쉽게 답변해."
        },
        { role: "user", content: message }
      ],
      max_tokens: 2048
    }
  );

  const answer = data.choices?.[0]?.message?.content?.trim();
  if (!answer) throw new Error("FreeTheAI 답변 없음");
  return answer;
}

// 채팅 API
app.post("/api/chat", async (req, res) => {
  const message = req.body?.message;

  if (typeof message !== "string" || !message.trim()) {
    return res.status(400).json({
      error: "메시지를 입력해 주세요."
    });
  }

  const providers = [
    ["Gemini", askGemini],
    ["Groq", askGroq],
    ["FreeTheAI", askFreeTheAI]
  ];

  for (const [name, ask] of providers) {
    try {
      console.log(name + " 사용 시도");

      const reply = await ask(message);

      console.log(name + " 답변 성공");

      return res.json({
        reply,
        provider: name
      });

    } catch (error) {
      console.log(
        name + " 실패:",
        error.status || "",
        error.message
      );
    }
  }

  return res.status(503).json({
    error:
      "세 AI 모두 답변하지 못했습니다. 무료 사용량, 이메일 인증, 일일 체크인을 확인해 주세요."
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Chat Buddy 서버 실행 중:", PORT);
});
