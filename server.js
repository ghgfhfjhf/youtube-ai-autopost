import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import fetch from "node-fetch";
import { google } from "googleapis";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ===============================
// HOME ROUTE
// ===============================
app.get("/", (req, res) => {
  res.send("🚀 AI YouTube Auto-Post Server is running!");
});

// ===============================
// ENSURE UPLOADS FOLDER EXISTS
// ===============================
const uploadDir = "uploads";

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// ===============================
// MULTER CONFIG (100MB LIMIT)
// ===============================
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});

// ===============================
// GOOGLE OAUTH
// ===============================
const oauth2Client = new google.auth.OAuth2(
  process.env.YT_CLIENT_ID,
  process.env.YT_CLIENT_SECRET,
  process.env.REDIRECT_URI
);

const SCOPES = ["https://www.googleapis.com/auth/youtube.upload"];

// ===============================
// AUTH START
// ===============================
app.get("/auth", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent"
  });
  res.redirect(url);
});

// ===============================
// AUTH CALLBACK
// ===============================
app.get("/auth/callback", async (req, res) => {
  try {
    const { tokens } = await oauth2Client.getToken(req.query.code);
    fs.writeFileSync("token.json", JSON.stringify(tokens));
    res.send("✅ Login success – app ready");
  } catch (err) {
    console.error(err);
    res.status(500).send("OAuth error");
  }
});

// ===============================
// GEMINI AI META GENERATOR
// ===============================
async function generateMeta(topic) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `Generate ONLY JSON with keys: title, description, tags for YouTube video about: ${topic}`
              }
            ]
          }
        ]
      })
    }
  );

  const data = await response.json();
  return JSON.parse(data.candidates[0].content.parts[0].text);
}

// ===============================
// VIDEO UPLOAD ROUTE
// ===============================
app.post("/upload", upload.single("video"), async (req, res) => {
  try {
    if (!fs.existsSync("token.json")) {
      return res.status(401).json({ error: "Login required first" });
    }

    const meta = await generateMeta(req.body.topic);

    oauth2Client.setCredentials(
      JSON.parse(fs.readFileSync("token.json"))
    );

    const youtube = google.youtube({
      version: "v3",
      auth: oauth2Client
    });

    const response = await youtube.videos.insert({
      part: "snippet,status",
      requestBody: {
        snippet: {
          title: meta.title,
          description: meta.description,
          tags: meta.tags,
          categoryId: "20"
        },
        status: {
          privacyStatus: "public"
        }
      },
      media: {
        body: fs.createReadStream(req.file.path)
      },
      timeout: 0 // IMPORTANT FOR RENDER
    });

    fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      videoId: response.data.id
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Upload failed" });
  }
});

// ===============================
// PORT FIX FOR RENDER
// ===============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});