const express     = require("express");
const { google }  = require("googleapis");
const OpenAI      = require("openai");
const { query }   = require("../db");
const requireAuth = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

function getOpenAI() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// ─── GET /outreach ─────────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const result = await query(
      "SELECT * FROM outreach WHERE user_id = $1 ORDER BY created_at DESC",
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("[outreach/GET]", err);
    res.status(500).json({ error: "Failed to fetch outreach entries" });
  }
});

// ─── POST /outreach ────────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  const {
    name, firm, role, source = "manual", stage = "Drafted",
    reply_status = "Awaiting Reply", follow_up_date, notes, gmail_thread_id,
  } = req.body;

  if (!name) return res.status(400).json({ error: "name is required" });

  try {
    const result = await query(
      `INSERT INTO outreach
         (user_id, name, firm, role, source, stage, reply_status, follow_up_date, notes, gmail_thread_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [req.userId, name, firm || null, role || null, source, stage,
       reply_status, follow_up_date || null, notes || null, gmail_thread_id || null]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error("[outreach/POST]", err);
    res.status(500).json({ error: "Failed to create outreach entry" });
  }
});

// ─── PATCH /outreach/:id ───────────────────────────────────────────────────────
router.patch("/:id", async (req, res) => {
  const { id } = req.params;
  const { name, firm, role, stage, reply_status, follow_up_date, notes } = req.body;

  try {
    const result = await query(
      `UPDATE outreach SET
         name            = COALESCE($1, name),
         firm            = COALESCE($2, firm),
         role            = COALESCE($3, role),
         stage           = COALESCE($4, stage),
         reply_status    = COALESCE($5, reply_status),
         follow_up_date  = COALESCE($6, follow_up_date),
         notes           = COALESCE($7, notes)
       WHERE id = $8 AND user_id = $9
       RETURNING *`,
      [name, firm, role, stage, reply_status, follow_up_date || null, notes, id, req.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("[outreach/PATCH]", err);
    res.status(500).json({ error: "Failed to update entry" });
  }
});

// ─── DELETE /outreach/:id ──────────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await query("DELETE FROM outreach WHERE id = $1 AND user_id = $2", [id, req.userId]);
    res.json({ success: true });
  } catch (err) {
    console.error("[outreach/DELETE]", err);
    res.status(500).json({ error: "Failed to delete entry" });
  }
});

// ─── POST /outreach/follow-up ──────────────────────────────────────────────────
// Body: { outreachId }
// Returns: { subject, body }
router.post("/follow-up", async (req, res) => {
  const { outreachId } = req.body;
  if (!outreachId) return res.status(400).json({ error: "outreachId is required" });

  try {
    const [entryRes, profileRes] = await Promise.all([
      query("SELECT * FROM outreach WHERE id = $1 AND user_id = $2", [outreachId, req.userId]),
      query("SELECT name, school, year, major FROM profiles WHERE user_id = $1", [req.userId]),
    ]);

    const entry = entryRes.rows[0];
    if (!entry) return res.status(404).json({ error: "Entry not found" });

    const profile = profileRes.rows[0] || {};
    const openai  = getOpenAI();

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.7,
      messages: [{
        role: "user",
        content: `Write a short follow-up cold email from a college student who previously reached out but hasn't heard back.

SENDER: ${profile.name || "the sender"}, ${profile.year || ""} ${profile.major || ""} student at ${profile.school || "their school"}
RECIPIENT: ${entry.name}${entry.firm ? ` at ${entry.firm}` : ""}${entry.role ? `, ${entry.role}` : ""}

Rules:
- Under 60 words total
- Reference the prior email briefly ("I wanted to follow up on my previous email")
- End with "if you have time for a quick call" — no time specified
- No fluff, no apologies for following up
- Sign off: Best,\\n${(profile.name || "").split(" ")[0] || "the sender"}

Return ONLY this JSON:
{ "subject": "Follow-up: <original topic>", "body": "full email text" }`,
      }],
    });

    const raw    = completion.choices[0].message.content.replace(/```json|```/g, "").trim();
    const result = JSON.parse(raw);
    res.json(result);
  } catch (err) {
    console.error("[outreach/follow-up]", err);
    res.status(500).json({ error: "Failed to generate follow-up" });
  }
});

// ─── POST /outreach/check-replies ─────────────────────────────────────────────
// Checks Gmail threads for each entry with a gmail_thread_id and updates reply_status.
router.post("/check-replies", async (req, res) => {
  try {
    const [profileRes, entriesRes] = await Promise.all([
      query("SELECT gmail_tokens FROM profiles WHERE user_id = $1", [req.userId]),
      query(
        "SELECT id, gmail_thread_id FROM outreach WHERE user_id = $1 AND gmail_thread_id IS NOT NULL AND reply_status != 'Replied'",
        [req.userId]
      ),
    ]);

    const tokens = profileRes.rows[0]?.gmail_tokens;
    if (!tokens) return res.json({ updated: 0 });

    const entries = entriesRes.rows;
    if (entries.length === 0) return res.json({ updated: 0 });

    const client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GMAIL_REDIRECT_URI
    );
    client.setCredentials(tokens);
    const gmail = google.gmail({ version: "v1", auth: client });

    let updated = 0;
    await Promise.all(entries.map(async (entry) => {
      try {
        const thread = await gmail.users.threads.get({
          userId: "me",
          id: entry.gmail_thread_id,
          format: "metadata",
          metadataHeaders: ["From"],
        });
        const messages = thread.data.messages || [];
        // A reply exists if there are more than 1 message in the thread
        // and at least one message has INBOX label (not just SENT/DRAFT)
        const hasReply = messages.length > 1 && messages.some(
          (m) => (m.labelIds || []).includes("INBOX")
        );
        if (hasReply) {
          await query(
            "UPDATE outreach SET reply_status = 'Replied', stage = 'Replied' WHERE id = $1",
            [entry.id]
          );
          updated++;
        }
      } catch (_) {
        // ignore per-thread errors (thread deleted, token scope issue, etc.)
      }
    }));

    res.json({ updated });
  } catch (err) {
    console.error("[outreach/check-replies]", err);
    res.status(500).json({ error: "Failed to check replies" });
  }
});

module.exports = router;
