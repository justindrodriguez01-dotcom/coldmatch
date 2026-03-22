const express     = require("express");
const multer      = require("multer");
const OpenAI      = require("openai");
const requireAuth = require("../middleware/auth");
const { query }   = require("../db");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const router = express.Router();

// All profile routes require a valid JWT.
router.use(requireAuth);

// ─── GET /profile ─────────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const result = await query(
      "SELECT * FROM profiles WHERE user_id = $1",
      [req.userId]
    );

    if (result.rows.length === 0) {
      return res.json(null); // No profile yet — caller creates one with POST
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("[profile/GET]", err);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

// ─── POST /profile ────────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  const {
    name, school, year, major, hometown,
    goal, target_field, target_role,
    timeline, background_blurb,
    work_experience, activities,
  } = req.body;

  try {
    // Upsert: insert if none exists, update if it does.
    const result = await query(
      `INSERT INTO profiles
         (user_id, name, school, year, major, hometown,
          goal, target_field, target_role, timeline,
          background_blurb, work_experience, activities, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         name             = EXCLUDED.name,
         school           = EXCLUDED.school,
         year             = EXCLUDED.year,
         major            = EXCLUDED.major,
         hometown         = EXCLUDED.hometown,
         goal             = EXCLUDED.goal,
         target_field     = EXCLUDED.target_field,
         target_role      = EXCLUDED.target_role,
         timeline         = EXCLUDED.timeline,
         background_blurb = EXCLUDED.background_blurb,
         work_experience  = EXCLUDED.work_experience,
         activities       = EXCLUDED.activities,
         updated_at       = NOW()
       RETURNING *`,
      [
        req.userId, name, school, year, major, hometown,
        goal, target_field, target_role, timeline,
        background_blurb,
        work_experience ? JSON.stringify(work_experience) : null,
        activities,
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("[profile/POST]", err);
    res.status(500).json({ error: "Failed to save profile" });
  }
});

// ─── POST /profile/parse-resume ───────────────────────────────────────────────
router.post("/parse-resume", requireAuth, upload.single("resume"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded." });
  }
  if (req.file.mimetype !== "application/pdf") {
    return res.status(400).json({ error: "Only PDF files are supported." });
  }

  try {
    const base64 = req.file.buffer.toString("base64");

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Parse this resume and extract the following fields. Return ONLY valid JSON, no markdown, no explanation.

{
  "name": "full name",
  "school": "most recent university or college name",
  "year": "graduation year or class year (e.g. '2026' or 'Junior')",
  "major": "field of study",
  "work_experience": [
    { "company": "company name", "role": "job title" }
  ],
  "activities": "clubs, organizations, extracurriculars as a short text summary"
}

If a field is not found, use null. For work_experience, include up to 4 most recent entries.`,
            },
            {
              type: "image_url",
              image_url: {
                url: `data:application/pdf;base64,${base64}`,
              },
            },
          ],
        },
      ],
      max_tokens: 600,
    });

    const raw = response.choices[0].message.content.trim();
    const parsed = JSON.parse(raw);
    res.json(parsed);
  } catch (err) {
    console.error("[profile/parse-resume]", err);
    res.status(500).json({ error: "Failed to parse resume." });
  }
});

module.exports = router;
