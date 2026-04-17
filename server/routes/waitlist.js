const express = require("express");
const { query } = require("../db");

const router = express.Router();

router.post("/", async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes("@")) {
    return res.status(400).json({ error: "valid email required" });
  }
  try {
    await query(
      `INSERT INTO waitlist (email, created_at)
       VALUES ($1, NOW())
       ON CONFLICT (email) DO NOTHING`,
      [email.toLowerCase().trim()]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("waitlist error", err);
    res.status(500).json({ error: "server error" });
  }
});

module.exports = router;
