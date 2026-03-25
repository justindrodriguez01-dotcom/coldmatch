const express      = require("express");
const { google }   = require("googleapis");
const { query }    = require("../db");
const requireAuth  = require("../middleware/auth");

const router = express.Router();

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GMAIL_REDIRECT_URI
);

function createMimeMessage(to, subject, body) {
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
  ];
  return Buffer.from(lines.join("\r\n"))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ─── GET /gmail/auth ───────────────────────────────────────────────────────────
// Returns a Google OAuth URL the client should redirect to.
router.get("/auth", requireAuth, (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/gmail.compose"],
    state: req.userId,
    prompt: "consent",
  });
  res.json({ authUrl });
});

// ─── GET /gmail/callback ───────────────────────────────────────────────────────
// Google redirects here after the user grants permission.
router.get("/callback", async (req, res) => {
  const { code, state: userId } = req.query;
  if (!code || !userId) {
    return res.status(400).send("Missing code or state parameter.");
  }
  try {
    const { tokens } = await oauth2Client.getToken(code);
    await query(
      `INSERT INTO profiles (user_id, gmail_tokens)
       VALUES ($1, $2)
       ON CONFLICT (user_id)
       DO UPDATE SET gmail_tokens = EXCLUDED.gmail_tokens`,
      [userId, JSON.stringify(tokens)]
    );
    res.redirect("https://coldmatch.co/dashboard.html?gmail=connected");
  } catch (err) {
    console.error("[gmail/callback]", err);
    res.status(500).send("Failed to connect Gmail. Please try again.");
  }
});

// ─── POST /gmail/draft ─────────────────────────────────────────────────────────
// Creates a Gmail draft for the authenticated user.
router.post("/draft", requireAuth, async (req, res) => {
  const { to, subject, body } = req.body;
  if (!subject || !body) {
    return res.status(400).json({ error: "subject and body are required" });
  }

  try {
    const result = await query(
      "SELECT gmail_tokens FROM profiles WHERE user_id = $1",
      [req.userId]
    );
    const tokens = result.rows[0]?.gmail_tokens;
    if (!tokens) {
      return res.status(401).json({ error: "gmail_not_connected" });
    }

    // Create a per-request client to avoid shared-state issues
    const client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GMAIL_REDIRECT_URI
    );
    client.setCredentials(tokens);

    const gmail   = google.gmail({ version: "v1", auth: client });
    const message = createMimeMessage(to || "", subject, body);
    await gmail.users.drafts.create({
      userId: "me",
      requestBody: { message: { raw: message } },
    });

    res.json({ success: true, message: "Draft saved to Gmail" });
  } catch (err) {
    console.error("[gmail/draft]", err);
    res.status(500).json({ error: "Failed to create draft" });
  }
});

module.exports = router;
