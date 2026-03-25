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
  });
  res.json({ authUrl });
});

// ─── GET /gmail/callback ───────────────────────────────────────────────────────
// Google redirects here after the user grants permission.
router.get("/callback", async (req, res) => {
  const { code, state } = req.query;

  console.log("[gmail/callback] code received:", !!code);
  console.log("[gmail/callback] state (userId):", state);

  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log("[gmail/callback] tokens received:", !!tokens);

    const result = await query(
      "UPDATE profiles SET gmail_tokens = $1 WHERE user_id = $2",
      [JSON.stringify(tokens), state]
    );
    console.log("[gmail/callback] db update result:", result.rowCount);

    res.redirect("https://coldmatch.co/dashboard.html?gmail=connected");
  } catch (err) {
    console.error("[gmail/callback] error:", err);
    res.redirect("https://coldmatch.co/dashboard.html?gmail=error");
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
