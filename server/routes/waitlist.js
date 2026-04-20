const express = require("express");
const nodemailer = require("nodemailer");
const { query } = require("../db");

const router = express.Router();

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "justindrodriguez01@gmail.com",
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

router.post("/", async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes("@")) {
    return res.status(400).json({ error: "valid email required" });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const timestamp = new Date().toISOString();

  try {
    const result = await query(
      `INSERT INTO waitlist (email, created_at)
       VALUES ($1, NOW())
       ON CONFLICT (email) DO NOTHING
       RETURNING email`,
      [normalizedEmail]
    );

    // Only send emails if this was a new signup (not a duplicate)
    if (result.rows.length > 0 && process.env.GMAIL_APP_PASSWORD) {
      await Promise.all([
        // Notification to Justin
        transporter.sendMail({
          from: "justindrodriguez01@gmail.com",
          to: "justindrodriguez01@gmail.com",
          subject: "New ColdMatch waitlist signup",
          text: `New signup:\n\nEmail: ${normalizedEmail}\nTimestamp: ${timestamp}`,
        }),
        // Confirmation to the user
        transporter.sendMail({
          from: "justindrodriguez01@gmail.com",
          to: normalizedEmail,
          subject: "You're on the ColdMatch waitlist",
          text: "Hey — you're on the list. We'll reach out when ColdMatch is ready for you. In the meantime, follow along at coldmatch.co. — Justin, ColdMatch",
        }),
      ]);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("waitlist error", err);
    res.status(500).json({ error: "server error" });
  }
});

module.exports = router;
