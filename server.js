const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "10mb" }));

// 이미지 업로드 설정
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("이미지 파일만 첨부할 수 있습니다."));
    }
  }
});

// 웹사이트 파일 제공
const publicFolder = path.join(__dirname, "public");
const rootIndex = path.join(__dirname, "index.html");
const publicIndex = path.join(publicFolder, "index.html");

app.use(express.static(publicFolder));

app.get("/", (req, res) => {
  if (fs.existsSync(publicIndex)) {
    return res.sendFile(publicIndex);
  }

  if (fs.existsSync(rootIndex)) {
    return res.sendFile(rootIndex);
  }

  res.status(404).send("index.html 파일을 찾을 수 없습니다.");
});

// 서버 상태 확인
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// AI 채팅
app.post("/api/chat", upload.single("image"), async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

    if (!apiKey) {
      return res.status(500).json({
        error: "GEMINI_API_KEY 환경변수가 설정되지 않았습니다."
      });
    }

    const message = (req.body.message || "").trim();

    if (!message && !req.file) {
      return res.status(400).json({
        error: "질문이나 사진을 보내 주세요."
      });
    }

    const parts = [
      {
        text:
          "너는 Chat Buddy라는 친절하고 유머러스한 AI 도우미야. " +
          "한국어로 자연스럽게 답하고, 진지한 질문에는 진지하게 답해. " +
          "초등학생도 이해하기 쉽게 설명해 줘.\n\n" +
          "사용자 질문: " +
          (message || "첨부된 사진을 자세히 분석해 줘.")
      }
    ];

    // 사진이 첨부된 경우
    if (req.file) {
      parts.push({
        inlineData: {
          mimeType: req.file.mimetype,
          data: req.file.buffer.toString("base64")
        }
      });
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: parts
            }
          ],
          generationConfig: {
            temperature: 0.8,
            maxOutputTokens: 2048
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini API 오류:", data);

      return res.status(502).json({
        error:
          data.error?.message ||
          "AI 연결에 실패했습니다."
      });
    }

    const reply = data.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("")
      .trim();

    if (!reply) {
      return res.status(502).json({
        error: "AI가 답변을 생성하지 못했습니다. 다시 시도해 주세요."
      });
    }

    res.json({ reply });

  } catch (error) {
    console.error("Chat Buddy 서버 오류:", error);

    res.status(500).json({
      error: "서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."
    });
  }
});

// 오류 처리
app.use((error, req, res, next) => {
  console.error(error);

  res.status(400).json({
    error: error.message || "요청을 처리할 수 없습니다."
  });
});

// 서버 실행
app.listen(PORT, () => {
  console.log(`Chat Buddy server running on port ${PORT}`);
});