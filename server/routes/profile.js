const express     = require("express");
const multer      = require("multer");
const OpenAI      = require("openai");
const pdfParse    = require("pdf-parse");
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
    // Exclude resume_pdf (binary) from the response; expose has_resume flag instead
    const result = await query(
      `SELECT id, user_id, name, school, year, major, hometown, goal,
              target_field, target_role, timeline, background_blurb,
              work_experience, activities, gmail_tokens, attach_resume,
              resume_filename, (resume_pdf IS NOT NULL) AS has_resume, updated_at
       FROM profiles WHERE user_id = $1`,
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
    timeline, work_experience, activities,
  } = req.body;

  try {
    // Upsert: insert if none exists, update if it does.
    const result = await query(
      `INSERT INTO profiles
         (user_id, name, school, year, major, hometown,
          goal, target_field, target_role, timeline,
          work_experience, activities, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
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
         work_experience  = EXCLUDED.work_experience,
         activities       = EXCLUDED.activities,
         updated_at       = NOW()
       RETURNING *`,
      [
        req.userId, name, school, year, major, hometown,
        goal, target_field, target_role, timeline,
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

// ─── PATCH /profile ───────────────────────────────────────────────────────────
// Partial update — currently used for toggling attach_resume.
router.patch("/", async (req, res) => {
  const { attach_resume } = req.body;
  try {
    await query(
      "UPDATE profiles SET attach_resume = $1, updated_at = NOW() WHERE user_id = $2",
      [!!attach_resume, req.userId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("[profile/PATCH]", err);
    res.status(500).json({ error: "Failed to update setting" });
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
    const { text } = await pdfParse(req.file.buffer);

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: `Parse the resume below and extract the following fields. Return ONLY valid JSON, no markdown, no explanation.

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

If a field is not found, use null. For work_experience, include up to 4 most recent entries.

Resume:
${text}`,
        },
      ],
      max_tokens: 600,
    });

    const raw = response.choices[0].message.content.trim();
    const parsed = JSON.parse(raw);

    // Persist the raw PDF so it can be attached to Gmail drafts later
    await query(
      `UPDATE profiles SET resume_pdf = $1, resume_filename = $2, updated_at = NOW()
       WHERE user_id = $3`,
      [req.file.buffer, req.file.originalname || "resume.pdf", req.userId]
    );

    res.json(parsed);
  } catch (err) {
    console.error("[profile/parse-resume]", err);
    res.status(500).json({ error: "Failed to parse resume." });
  }
});

module.exports = router;
