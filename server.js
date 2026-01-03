import express from "express";
import cors from "cors";
import multer from "multer";
import fetch from "node-fetch";
import fs from "fs";
import { google } from "googleapis";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: "uploads/" });

const oauth2Client = new google.auth.OAuth2(
  process.env.YT_CLIENT_ID,
  process.env.YT_CLIENT_SECRET,
  process.env.REDIRECT_URI
);

const SCOPES = ["https://www.googleapis.com/auth/youtube.upload"];

app.get("/auth", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES
  });
  res.redirect(url);
});

app.get("/auth/callback", async (req, res) => {
  const { tokens } = await oauth2Client.getToken(req.query.code);
  fs.writeFileSync("token.json", JSON.stringify(tokens));
  res.send("✅ Login success – app ready");
});

async function gemini(topic) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${process.env.GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `Generate YouTube SEO JSON for: ${topic}` }] }]
    })
  });
  const j = await r.json();
  return JSON.parse(j.candidates[0].content.parts[0].text);
}

app.post("/upload", upload.single("video"), async (req, res) => {
  const meta = await gemini(req.body.topic);
  oauth2Client.setCredentials(JSON.parse(fs.readFileSync("token.json")));

  const youtube = google.youtube({ version: "v3", auth: oauth2Client });

  const r = await youtube.videos.insert({
    part: "snippet,status",
    requestBody: {
      snippet: {
        title: meta.title,
        description: meta.description,
        tags: meta.tags,
        categoryId: "20"
      },
      status: { privacyStatus: "public" }
    },
    media: { body: fs.createReadStream(req.file.path) }
  });

  fs.unlinkSync(req.file.path);
  res.json({ success: true, videoId: r.data.id });
});

app.listen(3000);