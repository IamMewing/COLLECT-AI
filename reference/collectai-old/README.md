# CollectAI 🤖💰

**Autonomous AI agent that chases overdue invoice payments for small Indian businesses.**

Built for the **Build with Gemini XPRIZE Hackathon** — Small Business Services category.

## What It Does

CollectAI is a background agent (not a chatbot) that:
1. Monitors your outstanding invoices daily
2. Uses **Gemini AI** to autonomously decide the next action for each overdue invoice
3. Drafts and sends personalized follow-up messages via email
4. Logs every decision with full AI reasoning for transparency
5. Tracks payments and provides quantifiable impact metrics

## Tech Stack

| Component | Technology |
|---|---|
| LLM | Gemini API (gemini-2.5-flash) |
| Backend | Node.js + Express |
| Database | Google Cloud Firestore |
| Email | Nodemailer (SMTP) |
| Frontend | Vanilla HTML/CSS/JS (SPA) |
| Hosting | Firebase Hosting (free tier) |
| Scheduling | Google Cloud Scheduler |

## Quick Start

### Prerequisites
- Node.js 20+
- A Google Cloud / Firebase project
- A Gemini API key

### Setup

```bash
# Clone the repo
git clone <repo-url>
cd collectai

# Install dependencies
npm install

# Copy env template and fill in your values
cp .env.example .env

# Start development server
npm run dev
```

### Environment Variables

See [.env.example](.env.example) for all required variables. Key ones:
- `GEMINI_API_KEY` — Get from [Google AI Studio](https://aistudio.google.com/)
- `FIREBASE_PROJECT_ID` — Your Firebase project ID
- `SMTP_*` — SMTP credentials (use [Ethereal](https://ethereal.email) for testing)

## Architecture

```
┌─────────────────────────────────┐
│  Dashboard (Firebase Hosting)   │
│  Vanilla HTML/CSS/JS SPA        │
└──────────────┬──────────────────┘
               │ fetch /api/*
┌──────────────▼──────────────────┐
│  Express API Server             │
│  ├── /api/businesses            │
│  ├── /api/invoices              │
│  ├── /api/agent/run             │
│  ├── /api/payments              │
│  └── /api/stats                 │
└──┬──────────┬──────────┬────────┘
   │          │          │
   ▼          ▼          ▼
Firestore   Gemini    Nodemailer
            API       (SMTP)
```

## AI Decision Engine

The agent evaluates each overdue invoice and returns a structured decision:

```json
{
  "decision": "firm_nudge",
  "reasoning_summary": "Invoice 12 days overdue, no response to first reminder...",
  "message_draft": "Hi [Client], just following up on invoice #INV-001...",
  "escalation_level": 2,
  "next_check_in_days": 3
}
```

**Decision options**: `no_action_needed` | `gentle_reminder` | `firm_nudge` | `escalate_to_owner`

Every decision and its reasoning is logged to the `agent_actions` Firestore collection — this is the proof that the AI is making autonomous decisions.

## Hackathon Submission

- **Category**: Small Business Services
- **Gemini API**: Used for invoice escalation decisions (structured JSON output)
- **Google Cloud**: Firestore (database) + Cloud Scheduler (daily trigger) + Firebase Hosting
- **Budget**: Google AI Pro + Cloud free tier only

## License

MIT
