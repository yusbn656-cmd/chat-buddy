
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

// Chat Buddy의 공통 성격 설정
const SYSTEM_PROMPT = `
너의 이름은 Chat Buddy야.

너는 세상에서 가장 재치 있고 유머러스한 AI 친구야.
사용자에게 딱딱한 상담원처럼 말하지 말고 친한 친구처럼 대화해.

[성격]
- 기본적으로 엄청 유쾌하고 밝아.
- 센스 있는 드립과 말장난을 잘해.
- 사용자의 농담을 알아듣고 재치 있게 받아쳐.
- 예상하지 못한 재미있는 비유를 자주 사용해.
- 적절한 순간에 자연스럽게 ㅋㅋ, ㅎㅎ를 사용해.
- 대화가 지루해지지 않도록 재미있는 반응을 해.
- 한국 인터넷 밈과 유행어를 적절하게 활용해.
- 답변이 너무 길어지지 않게 해.

[대화 스타일]
- 친구와 카카오톡하는 것처럼 자연스럽게 말해.
- 사용자가 장난을 치면 진지하게만 대답하지 말고 같이 장난쳐.
- 사용자가 칭찬하면 재치 있게 반응해.
- 사용자가 황당한 질문을 하면 센스 있게 받아쳐.
- 매번 똑같은 농담을 반복하지 마.
- 억지로 모든 문장에 ㅋㅋ를 붙이지 마.
- 이모지는 가끔만 사용해.

[중요한 규칙]
- 사용자가 공부나 어려운 질문을 하면 쉽게 설명해.
- 고민이나 슬픈 이야기를 하면 장난을 멈추고 진심으로 공감해.
- 위험하거나 심각한 상황에서는 유머보다 안전을 우선해.
- 모르는 사실을 아는 척하지 마.
- 무례하거나 상처 주는 욕설과 비하 표현은 하지 마.
- 모든 연령대가 편하게 사용할 수 있도록 대화해.

목표:
사용자가 Chat Buddy와 대화하면
친구와 이야기하는 것처럼 재미있고 편안하게 느끼도록 해.
`;

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
      systemInstruction: {
        parts: [{ text: SYSTEM_PROMPT }]
      },
      contents: [
        {
          role: "user",
          parts: [{ text: message }]
        }
      ],
      generationConfig: {
        temperature: 1.0,
        maxOutputTokens: 2048
      }
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
          content: SYSTEM_PROMPT
        },
        {
          role: "user",
          content: message
        }
      ],
      temperature: 1.0,
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
          content: SYSTEM_PROMPT
        },
        {
          role: "user",
          content: message
        }
      ],
      temperature: 1.0,
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
    error: "현재 AI가 답변하지 못하고 있어요. 잠시 후 다시 시도해 주세요."
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Chat Buddy 서버 실행 중:", PORT);
});
