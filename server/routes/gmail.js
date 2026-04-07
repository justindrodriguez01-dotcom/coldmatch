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

function toBase64Url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function createMimeMessage(to, subject, body) {
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
  ];
  return toBase64Url(Buffer.from(lines.join("\r\n")));
}

function createMimeMessageWithAttachment(to, subject, body, pdfBuffer, filename) {
  const boundary = `cm_boundary_${Date.now()}`;
  // Ensure the PDF is a proper Buffer regardless of how pg returned it
  const safePdfBuffer = Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer);
  // Split base64 into 76-char lines as required by MIME spec
  const b64 = safePdfBuffer.toString("base64");
  const pdfBase64 = b64.match(/.{1,76}/g)?.join("\r\n") ?? b64;
  // Normalise body line endings so the MIME structure is consistent
  const normalizedBody = body.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
  const parts = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    normalizedBody,
    "",
    `--${boundary}`,
    "Content-Type: application/pdf",
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${filename}"`,
    "",
    pdfBase64,
    "",
    `--${boundary}--`,
  ];
  return toBase64Url(Buffer.from(parts.join("\r\n")));
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
  const { to, subject, body, contactName, contactFirm, contactRole } = req.body;
  if (!subject || !body) {
    return res.status(400).json({ error: "subject and body are required" });
  }

  try {
    const result = await query(
      "SELECT gmail_tokens, attach_resume, resume_pdf, resume_filename FROM profiles WHERE user_id = $1",
      [req.userId]
    );
    const row    = result.rows[0];
    const tokens = row?.gmail_tokens;
    if (!tokens) {
      return res.status(401).json({ error: "gmail_not_connected" });
    }

    console.log("[gmail/draft] attach_resume:", row.attach_resume,
      "| resume_pdf:", row.resume_pdf
        ? `Buffer(${Buffer.isBuffer(row.resume_pdf) ? row.resume_pdf.length : typeof row.resume_pdf} bytes)`
        : "null",
      "| resume_filename:", row.resume_filename ?? "null");
    console.log("[gmail/draft] using attachment branch:", !!(row.attach_resume && row.resume_pdf));

    // Create a per-request client to avoid shared-state issues
    const client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GMAIL_REDIRECT_URI
    );
    client.setCredentials(tokens);

    const gmail = google.gmail({ version: "v1", auth: client });

    let message;
    if (row.attach_resume && row.resume_pdf) {
      message = createMimeMessageWithAttachment(
        to || "",
        subject,
        body,
        row.resume_pdf,
        row.resume_filename || "resume.pdf"
      );
    } else {
      message = createMimeMessage(to || "", subject, body);
    }

    const draftRes = await gmail.users.drafts.create({
      userId: "me",
      requestBody: { message: { raw: message } },
    });

    const threadId = draftRes.data?.message?.threadId || null;

    // Auto-log to outreach tracker (best-effort)
    if (contactName) {
      const followUpDate = new Date();
      followUpDate.setDate(followUpDate.getDate() + 7);
      const followUpStr = followUpDate.toISOString().split("T")[0];
      query(
        `INSERT INTO outreach (user_id, name, firm, role, source, stage, reply_status, follow_up_date, gmail_thread_id)
         VALUES ($1,$2,$3,$4,'extension','Drafted','Awaiting Reply',$5,$6)`,
        [req.userId, contactName, contactFirm || null, contactRole || null, followUpStr, threadId]
      ).catch((err) => console.error("[gmail/draft] outreach log failed:", err));
    }

    res.json({ success: true, message: "Draft saved to Gmail" });
  } catch (err) {
    console.error("[gmail/draft]", err);

    // Expired or revoked token — clear it so the dashboard shows disconnected
    const isInvalidGrant =
      err?.message?.includes("invalid_grant") ||
      err?.response?.data?.error === "invalid_grant";
    if (isInvalidGrant) {
      await query(
        "UPDATE profiles SET gmail_tokens = NULL WHERE user_id = $1",
        [req.userId]
      ).catch(() => {}); // best-effort
      return res.status(401).json({ error: "gmail_reauth_required" });
    }

    res.status(500).json({ error: "Failed to create draft" });
  }
});

module.exports = router;
