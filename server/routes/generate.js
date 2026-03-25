const express = require("express");
const OpenAI  = require("openai");

const router = express.Router();
// TODO: re-add auth middleware after frontend auth is implemented
// const requireAuth = require("../middleware/auth");
// router.use(requireAuth);

function getOpenAI() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function buildSenderBlock(u) {
  return [
    `- Name: ${u.name || "not provided"}`,
    `- School: ${u.school || "not provided"}${u.year ? `, ${u.year} year` : ""}`,
    `- Major: ${u.major || "not provided"}`,
    `- Hometown: ${u.hometown || "not provided"}`,
    `- Target job location: ${u.target_job_location || "not provided"}`,
    `- Career goal: ${u.goal || "not provided"}`,
    `- Target field: ${u.target_field || "not provided"}`,
    `- Target role type: ${u.target_role || "not provided"} (internship/full-time/exploring)`,
    `- Timeline: ${u.timeline || "not provided"}`,
    `- Work experience: ${u.work_experience || "not provided"}`,
    `- Activities and clubs: ${u.activities || "not provided"}`,
    `- Background: ${u.background_blurb || "not provided"}`,
  ].join("\n");
}

const ANGLE_DESCRIPTIONS = {
  career_path:        "sender wants to understand how recipient built their career and what decisions led them here",
  firm_industry:      "sender is specifically curious about what the recipient's firm does and how they think about their work",
  internship_advice:  "sender wants honest advice on how to break into this field and what to focus on",
  referral:           "sender is respectfully seeing if recipient knows of opportunities or could make an introduction",
  day_to_day:         "sender wants to understand what the work actually looks like day to day beyond the job title",
  general:            "sender wants to start a genuine professional relationship with no specific immediate ask",
};

// ─── POST /generate/score ──────────────────────────────────────────────────────
// Body: { profileData: string, userProfile: object }
// Returns: { score, reasons, recommendation }
router.post("/score", async (req, res) => {
  const { profileData, userProfile } = req.body;

  if (!profileData || !userProfile) {
    return res.status(400).json({ error: "profileData and userProfile are required" });
  }

  try {
    const openai = getOpenAI();

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages: [{
        role: "user",
        content: `You are an experienced career mentor helping a college student decide whether a specific LinkedIn connection is worth cold emailing right now.

You have full context on both people:

SENDER:
${buildSenderBlock(userProfile)}

RECIPIENT:
${profileData}

Your job: Give an honest, calibrated score from 0-100 representing how valuable it would be for THIS sender to reach out to THIS recipient RIGHT NOW given the sender's specific goals and stage.

Think like a mentor who actually knows the sender personally and is advising them on whether this is a good use of their time. Consider:
- Is this person genuinely relevant to what the sender wants to achieve right now? Not just impressive, but actually useful for their specific goal.
- Is there any real common ground that makes the outreach feel natural rather than random? (shared school, hometown proximity, similar background, relevant career path)
- Given the sender's stage and experience level, is this person realistically going to respond and provide value?
- Does the recipient's seniority, field, role, and company actually align with what the sender is trying to do?
- Is the timing right? (e.g. a freshman reaching out to a senior banker during peak recruiting season)

Be honest. A peer with only student orgs is not useful for someone trying to get a PE internship. A senior professional in a completely different field is not useful regardless of how impressive they are. A mid-level professional at a target firm who shares the sender's school is extremely valuable.

Return ONLY this JSON, no explanation:
{
  "score": number,
  "reasons": [
    "specific reason 1",
    "specific reason 2",
    "specific reason 3"
  ],
  "recommendation": "strong match" | "worth reaching out" | "weak match"
}

Reasons must be specific to these two people — never generic.
Bad: "Relevant industry experience"
Good: "VP at Vanbarton Group, a real estate PE firm aligned with sender's target field of private equity"`,
      }],
    });

    const raw    = completion.choices[0].message.content.replace(/```json|```/g, "").trim();
    const result = JSON.parse(raw);
    res.json(result);
  } catch (err) {
    console.error("[generate/score]", err);
    res.status(500).json({ error: "Score generation failed" });
  }
});

// ─── POST /generate/email ──────────────────────────────────────────────────────
// Body: { profileData: string, userProfile: object, targetingAngle: string }
// Returns: { subject, body }
router.post("/email", async (req, res) => {
  const { profileData, userProfile, targetingAngle } = req.body;

  if (!profileData || !userProfile) {
    return res.status(400).json({ error: "profileData and userProfile are required" });
  }

  const angleKey = targetingAngle && ANGLE_DESCRIPTIONS[targetingAngle] ? targetingAngle : "general";
  const angleDescription = ANGLE_DESCRIPTIONS[angleKey];

  try {
    const openai = getOpenAI();

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.8,
      messages: [{
        role: "user",
        content: `You are writing a cold outreach email on behalf of a college student. This email must sound like a real human wrote it — not AI, not a template, not a cover letter.

SENDER CONTEXT:
${buildSenderBlock(userProfile)}

RECIPIENT CONTEXT:
${profileData}

SENDER'S ANGLE FOR THIS EMAIL:
${angleDescription}

HOOK PRIORITY — use the strongest available hook, in this order:
1. Same school as sender → always lead with this if true
2. Recipient's firm is in or near sender's hometown → mention the geographic connection
3. Recipient made a notable career transition or has an unusual path → reference that specifically
4. Specific knowledge of what their firm does → show you did research
5. Their career progression over time → reference tenure or growth
6. Nothing specific → keep email very short and purely curiosity-driven, do not invent details

EMAIL RULES:
- Greeting: Hi [first name],
- Introduce yourself: name, school, year (1 sentence max)
- One specific observation anchored in real profile data (NOT from their About section — from their actual career history, school, or firm). State the fact. Do not editorialize or compliment.
- Express genuine curiosity shaped by the targeting angle
- Low-pressure ask: reference being busy, 15 min call
- Sign off: Best, then name on separate line
- Total length: under 120 words
- Sound like a confident college student writing a real email, not a cover letter
- NEVER use: "which must involve", "which is fascinating", "truly impressive", "really resonated", "your journey", "I came across your profile", "was impressed by", "that kind of dedication", "I hope this finds you well", "would greatly appreciate", "any insights you could share", "thank you for considering", "I look forward to", "extensive experience", "built a strong career"
- NEVER summarize their About section back to them
- NEVER compliment a skill or trait directly
- NEVER invent details not in the profile data
- NEVER mention internships, jobs, or recruiting directly unless the angle is internship_advice or referral
- If nothing specific and accurate can be said, write a very short generic curiosity email rather than inventing details

Return ONLY this JSON:
{
  "subject": "under 8 words, specific, no recipient name, curiosity-driven",
  "body": "the full email body — use \\n\\n between paragraphs and \\n for single line breaks (e.g. between Best, and sender name)"
}`,
      }],
    });

    const raw    = completion.choices[0].message.content.replace(/```json|```/g, "").trim();
    const result = JSON.parse(raw);
    res.json(result);
  } catch (err) {
    console.error("[generate/email]", err);
    res.status(500).json({ error: "Email generation failed" });
  }
});

module.exports = router;
