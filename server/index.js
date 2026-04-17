require("dotenv").config();
const express = require("express");
const cors    = require("cors");
const path    = require("path");

const authRoutes     = require("./routes/auth");
const profileRoutes  = require("./routes/profile");
const generateRoutes = require("./routes/generate");
const gmailRoutes    = require("./routes/gmail");
const outreachRoutes = require("./routes/outreach");
const findRoutes     = require("./routes/find");
const waitlistRoutes = require("./routes/waitlist");

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── CORS ────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: [
    'https://coldmatch.co',
    'https://www.coldmatch.co',
    'http://coldmatch.co',
    'http://localhost:3000',
    /^chrome-extension:\/\//
  ],
  credentials: true
}));

// ─── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json());

// ─── Static files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "public")));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use("/auth",     authRoutes);
app.use("/profile",  profileRoutes);
app.use("/generate", generateRoutes);
app.use("/auth/gmail", gmailRoutes);
app.use("/outreach", outreachRoutes);
app.use("/find",     findRoutes);
app.use("/waitlist", waitlistRoutes);

// ─── Global error handler ────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});

// ─── Page routes (extensionless URLs) ────────────────────────────────────────
app.get("/signup",     (_req, res) => res.sendFile(path.join(__dirname, "public", "signup.html")));
app.get("/login",      (_req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));
app.get("/dashboard",  (_req, res) => res.sendFile(path.join(__dirname, "public", "app", "index.html")));
app.get("/onboarding", (_req, res) => res.sendFile(path.join(__dirname, "public", "onboarding.html")));

// ─── Catch-all: serve index.html for any unmatched GET ───────────────────────
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`ColdMatch server running on port ${PORT}`); // redeploy
});
