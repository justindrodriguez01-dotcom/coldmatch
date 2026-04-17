const express     = require("express");
const multer      = require("multer");
const xlsx        = require("xlsx");
const axios       = require("axios");
const cheerio     = require("cheerio");
const OpenAI      = require("openai");
const { query }   = require("../db");
const requireAuth = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

function getOpenAI() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// ─── Finance heuristics ───────────────────────────────────────────────────────

const FINANCE_FIRMS = new Set([
  "goldman sachs", "morgan stanley", "jpmorgan chase", "jpmorgan", "jp morgan",
  "bank of america", "citigroup", "citi", "deutsche bank", "barclays", "ubs",
  "credit suisse", "wells fargo", "jefferies", "lazard", "evercore", "moelis",
  "pjt partners", "houlihan lokey", "rothschild", "perella weinberg",
  "blackstone", "kkr", "carlyle", "apollo global management", "apollo",
  "tpg", "warburg pincus", "bain capital", "vista equity", "silver lake",
  "advent international", "general atlantic", "summit partners",
  "francisco partners", "thoma bravo", "ares management",
  "citadel", "two sigma", "de shaw", "renaissance technologies",
  "millennium management", "bridgewater", "point72", "aqr capital",
  "farallon capital", "tiger global", "coatue management", "lone pine",
  "blackrock", "vanguard", "fidelity", "state street", "pimco",
  "man group", "tudor investment", "baupost",
]);

const FINANCE_KEYWORDS = [
  "capital", "partners", "investment", "investments", "management",
  "advisors", "securities", "asset", "equity", "fund", "financial",
  "ventures", "trading", "banking", "wealth", "portfolio", "hedge",
];

const SENIOR_ROLES = ["managing director", "md", "partner", "managing partner", "head of"];
const MID_ROLES    = ["vice president", " vp", "director", "principal", "senior associate"];
const JUNIOR_ROLES = ["analyst", "associate", "summer analyst", "investment banking"];

function matchLevel(contact, userSchool) {
  const co   = (contact.company || "").toLowerCase();
  const role = (contact.role    || "").toLowerCase();
  const sch  = (contact.school  || "").toLowerCase();

  let score = 0;

  // Company
  if (FINANCE_FIRMS.has(co)) score += 4;
  else if (FINANCE_KEYWORDS.some(k => co.includes(k))) score += 2;

  // Role
  if (SENIOR_ROLES.some(r => role.includes(r))) score += 3;
  else if (MID_ROLES.some(r => role.includes(r)))  score += 2;
  else if (JUNIOR_ROLES.some(r => role.includes(r))) score += 1;

  // School match (strongest personalisation hook)
  if (userSchool && sch) {
    const us = userSchool.toLowerCase();
    if (us.includes(sch.slice(0, 6)) || sch.includes(us.slice(0, 6))) score += 4;
  }

  // Has LinkedIn (enhanced generation possible)
  if (contact.linkedin_url) score += 1;

  if (score >= 5) return "High";
  if (score >= 2) return "Medium";
  return "Low";
}

// ─── Build profile data string for generation ────────────────────────────────

function buildProfileString(contact, assumedSchool) {
  // If a raw LinkedIn scrape blob was passed, use it directly as richer context
  if (contact.profileText) return contact.profileText;
  const lines = [];
  if (contact.name)         lines.push(`Name: ${contact.name}`);
  if (contact.role)         lines.push(`Current Role: ${contact.role}`);
  if (contact.company)      lines.push(`Current Firm: ${contact.company}`);
  if (contact.school)       lines.push(`School: ${contact.school}`);
  else if (assumedSchool)   lines.push(`School: ${assumedSchool} (alumni database — treat as confirmed)`);
  if (contact.email)        lines.push(`Email: ${contact.email}`);
  return lines.join("\n") || "Limited information available";
}

// ─── Email prompt for CSV contacts ───────────────────────────────────────────

function buildBatchEmailPrompt(profileData, userProfile, sharedSchool) {
  const stage = userProfile.recruiting_stage || "not provided";
  const areas = userProfile.target_areas     || "not provided";

  const senderBlock = [
    `SENDER DATA:`,
    `- Full name: ${userProfile.name       || "not provided"}`,
    `- School: ${userProfile.school        || "not provided"}`,
    `- Year: ${userProfile.year            || "not provided"}`,
    `- Major: ${userProfile.major          || "not provided"}`,
    `- Hometown: ${userProfile.hometown    || "not provided"}`,
    `- Activities & clubs: ${userProfile.activities || "not provided"}`,
    `- Recruiting stage: ${stage}`,
    `- Target areas: ${areas}`,
    `- Selected angle: How they broke into finance and their advice for someone trying to do the same`,
    `- Attach resume: ${userProfile.attach_resume ? "true" : "false"}`,
  ].join("\n");

  const recipientBlock = `\
RAW SCRAPED DATA — read this carefully before filling in the block below:
${profileData}

RECIPIENT DATA — populate each field using ONLY what is explicitly stated in the raw data above.
If a field is not clearly and explicitly present, write NOT AVAILABLE. Do not infer, invent, or assume.
- Full name: [extract from data]
- Current role: [job title — only if explicitly present, otherwise: NOT AVAILABLE]
- Current firm: [employer — only if explicitly present, otherwise: NOT AVAILABLE]
- Previous roles: [list of previous titles and firms from experience — only what is explicitly present, otherwise: NOT AVAILABLE]
- Education: [schools attended — only what is explicitly in education data, otherwise: NOT AVAILABLE]
- Location: [city/region — only if explicitly present, otherwise: NOT AVAILABLE]
- About section: [verbatim if present, otherwise: NOT AVAILABLE]

Any field marked NOT AVAILABLE must never be referenced, implied, or compensated for in the email.
If a field is NOT AVAILABLE, act as if that information does not exist.`;

  // CTA — 3-branch calibration matching generate.js
  let ctaRule = `Ask: close with a low-pressure ask for a quick call. Acknowledge they're busy.`;
  const sl = stage.toLowerCase();
  if (sl.includes("building early connections") || sl.includes("exploring")) {
    ctaRule = `Ask (soft): express genuine curiosity and close with something like "would love to hear your perspective if you ever have a few minutes." No pressure, no job ask.`;
  } else if (sl.includes("actively looking for any relevant")) {
    ctaRule = `Ask (warm): slightly more direct — "would love to connect and learn more about your path" — keep it relational, not transactional.`;
  } else if (sl.includes("sophomore") || sl.includes("junior") || sl.includes("senior")) {
    ctaRule = `Ask (direct): reference their target areas explicitly — "would love to find time for a quick call${areas !== "not provided" ? ` about ${areas} recruiting` : ""} if you're open to it."`;
  }

  const resumeRule = userProfile.attach_resume
    ? `RESUME: The sender is attaching their resume. Include exactly one natural mention — e.g. "I've attached my resume for reference" — placed where it fits. Do not force it at the end.`
    : `RESUME: attach_resume is false. Do NOT mention a resume anywhere in the email under any circumstances.`;

  const sharedSchoolNote = sharedSchool
    ? `SCHOOL HOOK: The sender and recipient both attended ${userProfile.school}. Lead with this — it is the strongest opener. State it plainly: "I noticed you went to [School] too" or "I saw you're a [School] alum."`
    : `SCHOOL HOOK: No confirmed shared school. Use one specific, verified observation about the recipient's role or career path as the hook instead. Never invent a hook.`;

  const subjectLine = sharedSchool
    ? `If shared university confirmed: "[School Name] Student Reaching Out" or "[School Name] Student Interested in [Recipient's Firm or Field]" — e.g. "${userProfile.school || "School"} Student Interested in IB at [Firm]"`
    : `No shared university: "[Sender School] Student Interested in [Recipient's Field or Firm]" — only reference firms or schools verified in the data.`;

  return `CRITICAL RULES — NON-NEGOTIABLE. Violating any of these is a failure:
1. Only reference facts explicitly listed in the RECIPIENT DATA block. Never invent or infer details.
2. Do not reference a school the recipient attended unless it is explicitly listed in their education data (or the SCHOOL HOOK note below).
3. Do not reference a firm unless it is explicitly listed as their current or previous employer.
4. Do not imply shared experiences unless that connection is explicitly verified in both sender and recipient data.
5. If a field is marked NOT AVAILABLE, do not mention it, imply it, or compensate by guessing around it.
6. If there is limited genuine overlap between sender and recipient, write a shorter and more honest cold outreach email. Do not fabricate connections.
7. Never summarize the recipient's About section back to them.
8. Never mention how long the sender has been interested in finance or any personal backstory beyond their current school, year, and major.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${recipientBlock}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${senderBlock}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STEP 1 — VERIFY SHARED BACKGROUND (do this silently before writing anything):
- Does the sender's school exactly match any school in the recipient's education data? If yes → shared university confirmed.
- Do any of the sender's activities or clubs match any organization in the recipient's profile? If yes → shared org confirmed.
- Does the sender's hometown match the recipient's location? If yes → shared location noted.
Only use a connection if it is confirmed here. If nothing is confirmed, do not force one.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${sharedSchoolNote}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STEP 2 — WRITE THE EMAIL using this exact structure:

1. Greeting: Hi [recipient first name only],
   — Never use Mr. or Ms. Regardless of seniority, always use first name only.

2. Intro (1 sentence): "My name is [sender full name], and I'm a [year] at [school] studying [major]."
   — Use the exact school name and major from SENDER DATA.

3. Hook (1 sentence): The single strongest verified connection from Step 1, stated plainly.
   — If shared university confirmed: lead with that — e.g. "I noticed you went to [School] too" or "I saw you're a [School] alum."
   — If no shared university: one specific, verified observation about the recipient's career based ONLY on confirmed RECIPIENT DATA. If no strong hook exists, use a brief honest reason for reaching out based on their field or role.
   — Never invent a hook. Never compliment a trait directly.

4. Body (1–2 sentences): Genuine curiosity about how they broke into finance and the path they took. Specific to what this person actually did.

5. ${ctaRule}

6. ${resumeRule}

7. Sign-off: Best,\\n[sender full name]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SUBJECT LINE RULES:
- ${subjectLine}
- Never say "Fellow Alum" — the sender is a current student, not an alum.
- Never use "Quick Question" or any vague filler subject line.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

HARD LIMITS:
- Under 120 words total (body only, excluding subject and sign-off)
- Email must sound like a real human wrote it — not AI, not a template

BANNED PHRASES — do not use any of these under any circumstances:
"your journey", "truly impressive", "your impressive background",
"I came across your profile and was impressed", "I would greatly appreciate",
"thank you for considering", "I hope this email finds you well",
"I hope this note finds you well", "which aligns with my goals",
"which aligns perfectly", "I noticed you also" (unless the shared connection is explicitly verified),
"extensive experience", "really resonated", "built a strong career",
"any insights you could share", "I look forward to", "which is fascinating",
"15 minutes" or any specific time duration for the ask,
any phrase that summarizes the recipient's About section,
any phrase that invents a specific deal, project, or initiative not in the data,
em dashes (—) in any form — rewrite any sentence that would use one to avoid it entirely; use a period, comma, or restructure the sentence instead

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Return ONLY this JSON:
{
  "subject": "subject line per the rules above",
  "body": "full email — \\n\\n between paragraphs, \\n between Best, and sender name"
}`;
}

// ─── POST /find/scrape ────────────────────────────────────────────────────────
router.post("/scrape", async (req, res) => {
  const { url } = req.body;
  if (!url || !url.includes("linkedin.com/in/")) {
    return res.status(400).json({ error: "Please enter a valid LinkedIn profile URL." });
  }

  // Check 7-day cache
  try {
    const cached = await query(
      "SELECT profile_data FROM linkedin_cache WHERE url = $1 AND scraped_at > NOW() - INTERVAL '7 days'",
      [url]
    );
    if (cached.rows.length > 0) {
      return res.json({ profileData: cached.rows[0].profile_data, cached: true });
    }
  } catch (_) {}

  // Attempt scrape
  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
      },
      timeout: 12000,
      maxRedirects: 5,
    });

    const html = response.data || "";
    const blocked =
      html.includes("authwall") ||
      html.includes("/checkpoint/") ||
      html.includes("Join LinkedIn") ||
      response.request?.res?.responseUrl?.includes("login") ||
      html.length < 3000;

    if (blocked) {
      return res.json({
        error: "Could not load this profile automatically. Try opening it in LinkedIn and using the extension instead.",
        blocked: true,
      });
    }

    const $ = cheerio.load(html);
    const name     = $("h1").first().text().trim();
    const headline = $("h2").first().text().trim() || $("[class*='headline']").first().text().trim();
    const location = $("[class*='location']").first().text().trim();

    const profileData = [
      name     ? `Name: ${name}`         : null,
      headline ? `Headline: ${headline}` : null,
      location ? `Location: ${location}` : null,
      "[Partial data — full personalization requires the LinkedIn extension]",
    ].filter(Boolean).join("\n");

    // Cache result
    try {
      await query(
        "INSERT INTO linkedin_cache (url, profile_data) VALUES ($1, $2) ON CONFLICT (url) DO UPDATE SET profile_data = $2, scraped_at = NOW()",
        [url, profileData]
      );
    } catch (_) {}

    res.json({ profileData, cached: false, partial: true });
  } catch (err) {
    const status = err.response?.status;
    if (status === 999 || status === 403 || status === 401 || status === 302) {
      return res.json({
        error: "Could not load this profile automatically. Try opening it in LinkedIn and using the extension instead.",
        blocked: true,
      });
    }
    console.error("[find/scrape]", err.message);
    res.json({
      error: "Could not load this profile automatically. Try opening it in LinkedIn and using the extension instead.",
      blocked: true,
    });
  }
});

// ─── POST /find/parse-upload ──────────────────────────────────────────────────
router.post("/parse-upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded." });

  try {
    const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "" });

    if (rows.length < 2) return res.status(400).json({ error: "File appears to be empty." });

    const columns = rows[0].map(c => String(c).trim()).filter(Boolean);
    const dataRows = rows.slice(1).filter(row => row.some(cell => String(cell).trim() !== ""));
    const allRows = dataRows.map(row =>
      Object.fromEntries(columns.map((col, i) => [col, String(row[i] ?? "").trim()]))
    );

    res.json({
      columns,
      preview: allRows.slice(0, 5),
      allRows,
      totalRows: allRows.length,
      filename: req.file.originalname || "upload.csv",
    });
  } catch (err) {
    console.error("[find/parse-upload]", err);
    res.status(400).json({ error: "Could not parse file. Please use a valid CSV or Excel file." });
  }
});

// ─── AI-powered scoring using user's full profile as the primary filter ───────
async function aiMatchLevel(contacts, userProfile) {
  const openai = getOpenAI();

  const userContext = [
    `School: ${userProfile.school || "not provided"}`,
    `Year: ${userProfile.year || "not provided"}`,
    `Goal: ${userProfile.goal || "not provided"}`,
    `Target areas: ${userProfile.target_areas || "not provided"}`,
    `Recruiting stage: ${userProfile.recruiting_stage || "not provided"}`,
    `Hometown: ${userProfile.hometown || "not provided"}`,
  ].join("\n");

  const contactList = contacts.map((c, i) =>
    `${i}: name="${c.name}" role="${c.role || ""}" company="${c.company || ""}" school="${c.school || ""}"`
  ).join("\n");

  const prompt = `You are scoring contacts in a CSV alumni database for a student doing finance recruiting.

USER PROFILE:
${userContext}

SCORING RULES — apply strictly in this order:
1. HIGH: Contact's current role or firm directly matches the user's target_areas. E.g. if target is "Investment Banking", score High for IB analysts, associates, VPs, MDs at banks. If target is "Private Equity", score High for PE roles.
2. MEDIUM: Adjacent finance roles clearly related but not the direct target. E.g. if targeting IB, PE/HF/VC/Corp Finance/FP&A = Medium. If targeting PE, hedge funds/VC/IB = Medium.
3. LOW: Anything outside finance entirely (HR, engineering, marketing, accounting at non-finance firms, consulting unless targeting consulting, etc.) or roles with no overlap with the user's goal.

IMPORTANT: Seniority alone does NOT make someone High. A senior HR director at a bank is LOW. A first-year IB analyst is HIGH if the user is targeting IB.

CONTACTS TO SCORE (index: fields):
${contactList}

Return ONLY valid JSON in this exact shape — a top-level object with a "scores" array:
{"scores":[{"index":0,"matchLevel":"High","reason":"IB Analyst at Goldman — direct match for IB target"},...]}`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0].message.content.trim();
  const parsed = JSON.parse(raw);
  // Accept {"scores":[...]}, {"results":[...]}, {"contacts":[...]}, or bare array
  const arr = parsed.scores || parsed.results || parsed.contacts ||
              (Array.isArray(parsed) ? parsed : Object.values(parsed).find(Array.isArray));
  if (!Array.isArray(arr)) throw new Error("Unexpected AI response shape: " + raw.slice(0, 200));
  console.log("[score-contacts] AI returned", arr.length, "scores, sample:", JSON.stringify(arr.slice(0,2)));
  return arr; // [{index, matchLevel, reason}]
}

// ─── POST /find/score-contacts ────────────────────────────────────────────────
// Body: { contacts: [{name,email,company,role,school}] }
router.post("/score-contacts", async (req, res) => {
  const { contacts } = req.body;
  if (!Array.isArray(contacts)) return res.status(400).json({ error: "contacts array required" });

  try {
    // Fetch full user profile — goal/target_areas are the primary scoring filter
    const profileRes = await query(
      `SELECT school, year, goal, target_areas, recruiting_stage, hometown
       FROM profiles WHERE user_id = $1`,
      [req.userId]
    );
    const userProfile = profileRes.rows[0] || {};
    const userSchool  = userProfile.school || "";

    console.log("[score-contacts] user profile context:", {
      goal:             userProfile.goal             || "(empty)",
      target_areas:     userProfile.target_areas     || "(empty)",
      recruiting_stage: userProfile.recruiting_stage || "(empty)",
      school:           userProfile.school           || "(empty)",
      profileRowFound:  !!profileRes.rows[0],
    });

    // Existing tracker entries for alreadyContacted flag
    const outreachRes = await query(
      "SELECT LOWER(name) AS n FROM outreach WHERE user_id = $1",
      [req.userId]
    );
    const existingSet = new Set(outreachRes.rows.map(r => r.n));

    // Deduplicate by email (primary) or name+company
    const seen = new Map();
    const deduped = [];
    for (const c of contacts) {
      const key = (c.email || "").toLowerCase().trim() ||
                  `${(c.name || "").toLowerCase()}|${(c.company || "").toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.set(key, true);
      const alreadyContacted = existingSet.has((c.name || "").toLowerCase().trim());
      deduped.push({ ...c, alreadyContacted });
    }

    // Score in batches of 60 to stay within token limits
    const BATCH = 60;
    let scored = [];
    for (let i = 0; i < deduped.length; i += BATCH) {
      const batch = deduped.slice(i, i + BATCH);
      try {
        const results = await aiMatchLevel(batch, userProfile);
        for (const r of results) {
          const idx = r.index ?? 0;
          if (batch[idx]) {
            batch[idx].matchLevel = r.matchLevel || "Low";
            batch[idx].matchReason = r.reason || "";
          }
        }
      } catch (err) {
        console.error("[find/score-contacts] AI scoring failed, falling back:", err.message);
        // Fallback to heuristic if AI fails
        for (const c of batch) {
          c.matchLevel  = matchLevel(c, userSchool);
          c.matchReason = "";
        }
      }
      scored = scored.concat(batch);
    }

    // Ensure every contact has a matchLevel
    for (const c of scored) {
      if (!c.matchLevel) c.matchLevel = "Low";
    }

    // Sort: non-contacted first, then High > Medium > Low
    const order = { High: 0, Medium: 1, Low: 2 };
    scored.sort((a, b) => {
      if (a.alreadyContacted !== b.alreadyContacted) return a.alreadyContacted ? 1 : -1;
      return (order[a.matchLevel] ?? 2) - (order[b.matchLevel] ?? 2);
    });

    res.json({ contacts: scored, userSchool });
  } catch (err) {
    console.error("[find/score-contacts]", err);
    res.status(500).json({ error: "Failed to score contacts" });
  }
});

// ─── POST /find/generate-batch ────────────────────────────────────────────────
// Body: { contacts: [...], assumedSchool? }
router.post("/generate-batch", async (req, res) => {
  const { contacts, assumedSchool } = req.body;
  if (!Array.isArray(contacts) || contacts.length === 0) {
    return res.status(400).json({ error: "contacts array required" });
  }
  if (contacts.length > 50) {
    return res.status(400).json({ error: "Maximum 50 contacts per batch" });
  }

  try {
    const profileRes = await query(
      `SELECT name, school, year, major, hometown, activities,
              recruiting_stage, target_areas, attach_resume
       FROM profiles WHERE user_id = $1`,
      [req.userId]
    );
    const up = profileRes.rows[0] || {};
    const userSchool = assumedSchool || up.school || "";
    const openai = getOpenAI();
    const results = [];

    for (const contact of contacts) {
      try {
        const schoolMatch = !!(
          userSchool &&
          contact.school &&
          (userSchool.toLowerCase().includes((contact.school || "").toLowerCase().slice(0, 6)) ||
           (contact.school || "").toLowerCase().includes(userSchool.toLowerCase().slice(0, 6)))
        );
        const sharedSchool = schoolMatch || (!contact.school && !!assumedSchool);

        const profileData = buildProfileString(contact, sharedSchool ? userSchool : null);
        const prompt = buildBatchEmailPrompt(profileData, up, sharedSchool);

        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          temperature: 0.7,
          messages: [{ role: "user", content: prompt }],
        });

        const raw = completion.choices[0].message.content.replace(/```json|```/g, "").trim();
        const result = JSON.parse(raw);
        results.push({ contact, subject: result.subject, body: result.body, error: null });
      } catch (err) {
        console.error("[find/generate-batch] single contact error:", err.message);
        results.push({ contact, subject: null, body: null, error: "Generation failed for this contact" });
      }
    }

    res.json({ results });
  } catch (err) {
    console.error("[find/generate-batch]", err);
    res.status(500).json({ error: "Batch generation failed" });
  }
});

// ─── POST /find/save-database ─────────────────────────────────────────────────
// Body: { filename, column_mapping, contacts }
router.post("/save-database", async (req, res) => {
  const { filename, column_mapping, contacts } = req.body;
  if (!filename || !Array.isArray(contacts)) {
    return res.status(400).json({ error: "filename and contacts are required" });
  }

  try {
    const result = await query(
      `INSERT INTO saved_databases (user_id, filename, column_mapping, contacts)
       VALUES ($1, $2, $3, $4) RETURNING id, filename, uploaded_at`,
      [req.userId, filename, JSON.stringify(column_mapping || {}), JSON.stringify(contacts)]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error("[find/save-database]", err);
    res.status(500).json({ error: "Failed to save database" });
  }
});

// ─── GET /find/databases ──────────────────────────────────────────────────────
router.get("/databases", async (req, res) => {
  try {
    const result = await query(
      `SELECT id, filename, column_mapping, jsonb_array_length(contacts) AS contact_count, uploaded_at
       FROM saved_databases WHERE user_id = $1 ORDER BY uploaded_at DESC`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("[find/databases GET]", err);
    res.status(500).json({ error: "Failed to fetch databases" });
  }
});

// ─── GET /find/databases/:id ──────────────────────────────────────────────────
router.get("/databases/:id", async (req, res) => {
  try {
    const result = await query(
      "SELECT id, filename, column_mapping, contacts FROM saved_databases WHERE id = $1 AND user_id = $2",
      [req.params.id, req.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("[find/databases/:id GET]", err);
    res.status(500).json({ error: "Failed to fetch database" });
  }
});

// ─── DELETE /find/databases/:id ───────────────────────────────────────────────
router.delete("/databases/:id", async (req, res) => {
  try {
    await query(
      "DELETE FROM saved_databases WHERE id = $1 AND user_id = $2",
      [req.params.id, req.userId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("[find/databases DELETE]", err);
    res.status(500).json({ error: "Failed to delete database" });
  }
});

// ─── POST /find/apollo-waitlist ───────────────────────────────────────────────
router.post("/apollo-waitlist", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "email is required" });

  try {
    await query(
      "INSERT INTO apollo_waitlist (email) VALUES ($1) ON CONFLICT DO NOTHING",
      [email.toLowerCase().trim()]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("[find/apollo-waitlist]", err);
    res.status(500).json({ error: "Failed to join waitlist" });
  }
});

module.exports = router;
