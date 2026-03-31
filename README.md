## ColdMatch

Chrome extension that helps finance students run smarter recruiting outreach. Reads a LinkedIn profile, scores how strong of a cold email target that person is (0–100), and drafts a personalized email saved directly to your Gmail drafts.

## How it works

1. Navigate to a LinkedIn profile
2. ColdMatch extracts their background and generates a match score with reasoning
3. Select which aspect of their background to focus on
4. A personalized cold email is saved to your Gmail drafts — ready to send

## Tech stack

- **Extension:** Vanilla JavaScript (Chrome Manifest V3)
- **Backend:** Node.js / Express hosted on Railway
- **Database:** PostgreSQL
- **Auth:** JWT + Gmail OAuth
- **AI:** OpenAI API (server-side, key never exposed to client)

## Structure

```
/extension    # Chrome extension source
/server       # Node.js backend
```

## Setup

### Backend

```bash
cd server
npm install
# Add .env with OPENAI_API_KEY, DATABASE_URL, JWT_SECRET
npm start
```

### Extension

1. Go to `chrome://extensions`
2. Enable Developer Mode
3. Click "Load unpacked" → select `/extension`

---

Live at [coldmatch.co](https://coldmatch.co)
