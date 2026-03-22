const express = require("express");
const OpenAI  = require("openai");

const router = express.Router();
// TODO: re-add auth middleware after frontend auth is implemented
// const requireAuth = require("../middleware/auth");
// router.use(requireAuth);

function getOpenAI() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function buildToneInstruction(goal) {
  switch (goal) {
    case "Finding a job":
      return "The sender is actively looking for opportunities. The tone should be purposeful and professional — subtly signal their interest in roles or teams without being blunt about job-seeking. The ask should feel natural, not transactional.";
    case "Seeking mentorship":
      return "The sender wants guidance from this person. Use a curious, deferential, and eager-to-learn tone. Genuine admiration for the recipient's path is appropriate. The ask should be humble — a short call to learn from their experience.";
    case "Exploring a career pivot":
      return "The sender is considering a career change and is drawn to this person's background. The tone should be open and exploratory — someone trying to understand a new field through the lens of someone who has navigated it.";
    case "Networking generally":
      return "No specific agenda — the sender genuinely wants to connect. Keep the tone warm, low-pressure, and authentic. The ask should feel like a conversation, not a pitch.";
    case "Finding collaborators":
      return "The sender is looking for people to work with on projects or ideas. Use an energetic, collaborative tone — convey excitement about what the recipient is building and suggest exploring shared interests.";
    default:
      return "Polished, respectful, and human. Confident but not pushy. Keep it natural and not overly formal.";
  }
}

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
        content: `You are evaluating whether it is worth sending a cold outreach email to a LinkedIn contact.

Sender context:
- Name: ${userProfile.name || "not provided"}
- School / Company: ${userProfile.school || "not provided"}
- Goal: ${userProfile.goal || "not provided"}
- Background: ${userProfile.background_blurb || "not provided"}

Recipient profile:
${profileData}

Score this match 0–100 based on how relevant this recipient is to the sender's stated goal.

Return ONLY valid JSON with no explanation outside it:
{
  "score": <integer 0-100>,
  "reasons": [<exactly 3 short strings, no bullet characters>],
  "recommendation": <"strong match" | "worth reaching out" | "weak match">
}`,
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
// Body: { profileData: string, userProfile: object }
// Returns: { subject, body }
router.post("/email", async (req, res) => {
  const { profileData, userProfile } = req.body;

  if (!profileData || !userProfile) {
    return res.status(400).json({ error: "profileData and userProfile are required" });
  }

  try {
    const openai = getOpenAI();

    const hasSenderContext = userProfile.name || userProfile.background_blurb;
    const senderSection = hasSenderContext ? `

Sender context:
- Name: ${userProfile.name || "not provided"}
- School / Company: ${userProfile.school || "not provided"}
- Goal: ${userProfile.goal || "not provided"}
- Background: ${userProfile.background_blurb || "not provided"}

Use the sender context to write the intro and make the email feel personal and grounded. Reference their background naturally — don't list it robotically.` : "";

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.8,
      messages: [{
        role: "user",
        content: `Write a cold outreach email and a subject line for it.

Structure:
- Greeting: The profile data begins with "Name: [full name]". Extract the first name and use it directly. Write "Hi [firstname]," on its own line. Never output a placeholder like [recipient first name].
- Intro: One sentence. Sender's name and school only. Example: "My name is Justin Rodriguez and I'm a freshman at Michigan."
- Body: 1-2 sentences. Include a specific observation about their background AND genuine curiosity about their path. These can be one sentence or two — combine them naturally if it reads better. The observation must go beyond restating their job title.
- Ask: Acknowledge they're busy, then make a low-pressure request for a 15-minute call. Example: "I know you're likely busy, but would you be open to a quick call? Happy to work around your schedule."
- Sign off: "Best," on its own line, then the sender's name on the next line.

Hard rules:
- Total email body must be under 120 words
- No em dashes anywhere in the email
- Never mention internships, job seeking, recruiting, or resume
- Never ask for anything except a conversation
- Sound like a confident college student writing a real email, not a cover letter
- Every email must feel like it could only be sent to this exact person
- Never editorialize after an observation. State the fact, then stop. BAD: "you've spent 8 years at TIAA, which must involve incredibly complex work" — GOOD: "you've spent 8 years at TIAA moving from wealth management into portfolio management"
- Never use: "which must involve", "which is fascinating", "which is inspiring", "truly impressive", "really resonated", "I came across your profile", "was impressed by", "your journey", "that kind of dedication", "came across your profile", "was impressed", "extensive experience", "would greatly appreciate", "any insights you could share", "thank you for considering", "I look forward to the possibility", "that kind of focus is rare", "truly inspiring", "I hope this message finds you well", "built a strong career", "transitioned from", "eager to learn", "I'd be grateful", "your ability to"
- Never compliment a skill or personal trait directly. "Your ability to..." is always banned. Do not repackage anything from their About section as a compliment or admiring observation.
- The specific observation must come only from their career history: company names, role titles, career transitions, tenure, or schools. Never pull the observation from their About section or self-description. They wrote their About section themselves — they already know it. BAD: "Your ability to cultivate trust-based client relationships while consistently exceeding financial goals is impressive" (this is just their About section reworded). GOOD: "I saw you've been at TIAA for 8 years, moving from wealth management into portfolio management."
- When referencing the recipient's work:
  - You MAY use your general knowledge of what their company is known for doing
  - You MAY reference what their role title implies they do day-to-day
  - If they have multiple current roles, mention the one most relevant to the sender's goal
  - You MUST NOT invent specific personal focus areas, specializations, or tasks unless explicitly stated in the profile data
  - If you lack specific information, anchor the observation on their career path or school instead

Subject line rules:
- Never use the recipient's name
- Never say "Quick Introduction" or any variant of it
- Make it specific to something in their background or the connection angle
- Curiosity-driven, like something a real person would write
- Under 8 words
- Examples: "Freshman curious about your path to PE", "Question about the jump from Wharton to SM", "Advice from someone who's been through IB recruiting"

Output:
- Return ONLY valid JSON, no explanation, no markdown
- Format: { "subject": "...", "body": "..." }
- The body must not include a subject line
- In the body field, use \\n\\n between paragraphs and \\n for single line breaks (e.g. between "Best," and the sender's name) so the email displays correctly in a textarea
${senderSection}
Profile Data:
${profileData}`,
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
