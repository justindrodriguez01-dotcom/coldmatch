# Liken Server

Express + PostgreSQL backend for the Liken Chrome extension.

## Setup

### 1. Install dependencies
```bash
cd server
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
```
Edit `.env` and fill in the values:

| Variable | Description |
|---|---|
| `DATABASE_URL` | Postgres connection string (e.g. from Railway) |
| `JWT_SECRET` | Any long random string — used to sign auth tokens |
| `OPENAI_API_KEY` | Your OpenAI API key |
| `PORT` | Port to listen on (default `3000`) |

### 3. Set up the database
Run the schema against your Postgres instance once:
```bash
psql $DATABASE_URL -f db/schema.sql
```
Or paste the contents of `db/schema.sql` into your Railway query console.

### 4. Start the server
```bash
npm start
```

For development with auto-restart on file changes (Node 18+):
```bash
npm run dev
```

---

## API Reference

### Health
```
GET /
→ { status: "ok" }
```

### Auth
```
POST /auth/register   { email, password }  → { token, userId }
POST /auth/login      { email, password }  → { token, userId }
```

### Profile  *(requires Authorization: Bearer <token>)*
```
GET  /profile                        → profile object | null
POST /profile  { name, school, year, major, hometown,
                 goal, target_role,
                 timeline, background_blurb,
                 work_experience, activities }
             → updated profile object
```

### Generate  *(requires Authorization: Bearer <token>)*
```
POST /generate/score  { profileData: string, userProfile: object }
  → { score: number, reasons: string[], recommendation: string }

POST /generate/email  { profileData: string, userProfile: object }
  → { subject: string, body: string }
```

---

## Deploying to Railway

1. Create a new Railway project and add a **Postgres** plugin.
2. Add a new **Node** service pointing at the `server/` folder.
3. Set the environment variables in Railway's dashboard.
4. Railway automatically sets `DATABASE_URL` — no extra config needed for the DB connection.
5. Run the schema SQL once from the Railway query console.
