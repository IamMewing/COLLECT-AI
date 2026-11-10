# CollectAI Agent Service — Strands starter kit

This is a real, tested Strands Agents implementation of the risk →
probability → plan → draft sweep described in the hackathon build spec.
Verified against **strands-agents v1.54.0** by installing it and
inspecting the actual API (not written from memory) — every import,
class, and method signature here has been checked against the real
package.

## Autonomous negotiation loop

Sending one reminder and waiting isn't the whole job — a real collections
process is back-and-forth. Once a message is approved and sent (real email,
`SEND_REAL_EMAIL=true`), its subject carries an `[INV-XXXX]` tag. Polling
`POST /api/agent/check-replies` reads the inbox over IMAP (the same Gmail
App Password already used for sending — no extra setup), matches any reply
back to its invoice by that tag, and hands the whole thread to a `negotiate`
agent node that decides, on its own, whether to:

- keep negotiating — and write the next reply itself, proposing a concrete
  installment plan if the client can't pay in full,
- consider it resolved (the client agreed or confirms payment was sent), or
- escalate to a human (disputes, hostility, anything it shouldn't decide alone).

`AUTO_APPROVE_NEGOTIATION=true` lets it send its own follow-ups unattended;
left unset (the default), it still does all the reading and deciding, but
queues the reply for review instead of sending it. See `agent/inbox.py`
(IMAP polling + reply parsing), `agent/execute.py`'s `handle_incoming_reply`,
and `agent/memory.py`'s conversation-thread storage. In production this is
meant to run on a schedule — a Cloud Scheduler job hitting
`/api/agent/check-replies` every few minutes, authenticated via the
`X-Scheduler-Secret` header (see `server/.env.example`) since there's no
browser session to present a cookie.

The moment this agent and the client land on a specific number — the full
balance, a negotiated settlement, or one installment — it calls PayPal's own
**Agent Toolkit** (`paypal-agent-toolkit`, see `agent/tools/paypal_tools.py`)
directly to mint a real, payable order and weaves the real link straight
into its reply, instead of just promising one in words. This is a different
integration style from the sweep/approve flow below: there, Node code
creates the order after a human approves; here, the LLM itself calls
PayPal's tool mid-conversation. Only the Orders API is wired up here — the
toolkit's invoicing tools hit the same `/v2/invoicing/invoices` endpoint
that already 403'd on this project's sandbox account (see "Why Orders API
instead of Invoicing" below), so they're deliberately left out.

When the client agrees to pay in more than one installment, the agent
commits to a real, structured plan rather than just a sentence describing
one: each installment is tracked independently (`agent/memory.py`'s
`payment_plans` store) with its own due date, status, and PayPal order.
`POST /api/agent/check-replies` — the same scheduled call that polls for
replies — also bills whichever installment has come due, minting its order
and emailing the client a fresh real link with no further negotiation
needed (`agent/execute.py`'s `process_due_installments`). The PayPal webhook
distinguishes an installment's order from a full-invoice one by a tag on
the order mapping, so paying installment 1 of 3 is recorded as progress,
not as the invoice being closed — only the last one marks it paid.

None of this was visible in the UI until now — three phases of real
backend work with nothing on screen to show for it. The dashboard's
**"Still working it"** panel (`client/src/components/NegotiationsPanel.tsx`,
reading `GET /api/agent/negotiations`) makes it watchable: every reply
thread with its full back-and-forth, and every payment plan with each
installment's status, amount, due date, and live PayPal link. A
**"Check for replies now"** button fires the same job Cloud Scheduler would
on a timer (`POST /api/agent/check-replies`), so a live demo doesn't have
to sit out the polling interval to show a reply actually being handled.

## PayPal integration (agentic commerce)

When a human approves the agent's drafted message, the server creates a
**real PayPal sandbox order** via the Orders (Checkout) API, and the real
approval/payment link gets woven into the message the agent drafted (it's
instructed to always include a `{{PAYMENT_LINK}}` token, which the server
substitutes). A **PayPal webhook** (`CHECKOUT.ORDER.APPROVED`) then closes
the loop automatically: the moment the client approves and the server
captures the payment, it's marked paid and the agent runs its reflection on
a real payment event — not a human clicking a button. See
**[PAYPAL_SETUP.md](./PAYPAL_SETUP.md)** for the step-by-step to get your
own free sandbox credentials (including why Orders API rather than
Invoicing — a PayPal sandbox-side permissions issue we hit and
documented). Everything here degrades gracefully with PayPal unconfigured
(`GET /api/paypal/status` tells you the current state) — the rest of the
pipeline still runs.

## WhatsApp & SMS (multichannel outreach)

Email was never going to be the only channel a collections agent needs —
plenty of overdue clients are more likely to read a text. WhatsApp sends go
through **Meta's own WhatsApp Cloud API directly** (`agent/tools/whatsapp_tools.py`,
`graph.facebook.com`), not Twilio — see "Why WhatsApp went direct to Meta,
not through Twilio" below for why. SMS support (`agent/tools/sms_tools.py`,
verified against the actually **installed `twilio` v9.13.0 package**) is
still in the codebase but this project has no Twilio phone number
configured, so it stays a print-only stub in practice. Whichever channel the
plan agent picks, it only ever picks `whatsapp` when a phone number is
actually on file for that invoice — the agent is told explicitly which
contact methods exist, so it can't draft a WhatsApp message to a client it
has no number for.

**Why WhatsApp went direct to Meta, not through Twilio:** the original plan
was Twilio for both WhatsApp and SMS. Two real constraints surfaced once it
came time to actually wire this up for the live demo, not in a sandbox:

1. Twilio's console no longer hands out a phone number usable via the REST
   API for free — only through its own "Try out" demo flow, which is
   console-only, canned-templates-only, and doesn't support custom TwiML
   webhook responses at all. A number usable from our own code requires
   upgrading to a paid Twilio account.
2. Separately, sending plain SMS to Indian numbers runs into **TRAI's DLT
   sender-registration requirement** — a regulatory rule, not a Twilio
   pricing one, that silently blocks unregistered senders at the carrier
   level.

Meta's Cloud API sidesteps both: it gives a genuinely free test number
during development (no card required, up to a handful of phone numbers
registered as testers), and WhatsApp isn't subject to India's SMS-specific
DLT rules. `agent/tools/whatsapp_tools.py` was built to Meta's documented
request/response shape for `POST /<PHONE_NUMBER_ID>/messages`, the same
"verify against the real contract, not memory" standard as every other
integration in this project — see that module's docstring for the one
caveat: this project's own sandbox has no outbound network access to
graph.facebook.com to test a live call against, so treat it as unverified
until it's actually been exercised from a deployed environment.

**The constraint that shaped WhatsApp's session handling, found by reading
Meta/Twilio's own docs instead of assuming WhatsApp works like email:**
WhatsApp's Business Platform only allows a free-form, business-initiated
message inside the **24-hour session window** opened by the client's own
last inbound message. Outside that window, a business-initiated send
requires a pre-approved message template — infrastructure this project
doesn't have set up. `send_whatsapp_message()` doesn't try to guess this in
advance the way the old Twilio-backed version did (branching to SMS outside
the window) — there's no SMS fallback anymore, so it just asks Meta's API
directly and reports whatever Meta actually says: a reply to a message the
client sent first succeeds; the agent's first-ever outreach on a phone-only
invoice fails cleanly with Meta's own error, reported as `status='failed'`,
until a template is set up. This is the same "catch the real API constraint
before demo day" instinct as the PayPal Invoicing 403 above, applied one
phase earlier.

An inbound text is matched back to its invoice the same two-tier way an
inbound email is matched by its `[INV-XXXX]` subject tag: first by an
`[INV-XXXX]` tag embedded in the message body (the agent's own outbound
texts append `(Ref: [INV-XXXX])` so a reply that quotes it resolves
instantly), falling back to a reverse lookup by phone number against active
conversations (`agent/memory.py`'s `find_active_conversation_by_phone`) when
no tag survived. From there it's the exact same channel-agnostic
`handle_incoming_reply` that handles email replies — the negotiation logic
doesn't know or care which channel a message arrived on, only
`agent/memory.py`'s conversation record does (tracking `recipient_phone` and
a per-turn `channel`).

`POST /api/whatsapp/webhook` receives inbound WhatsApp the way
`POST /api/paypal/webhook` receives payment events: Meta signs every
request with `X-Hub-Signature-256` (an HMAC-SHA256 over the raw body, keyed
with the app secret), the server verifies that signature before trusting
anything in the body, and rejects with `401` otherwise —
`META_WHATSAPP_WEBHOOK_ALLOW_UNVERIFIED=true` is an explicit, documented
escape hatch for local testing only, never for a real deployment. A separate
`GET /api/whatsapp/webhook` handles Meta's one-time verification handshake
(echoing back `hub.challenge` only if `hub.verify_token` matches). See
`server/.env.example` for the Meta app credentials this needs
(`META_WHATSAPP_ACCESS_TOKEN`, `META_WHATSAPP_PHONE_NUMBER_ID`,
`META_WHATSAPP_VERIFY_TOKEN`, `META_WHATSAPP_APP_SECRET`) — like PayPal and
real email, this degrades gracefully when unconfigured: `GET
/api/whatsapp/status` reports the current state, and outreach just stays on
whichever channels **are** configured (email, always).

## AI voice calls

The fourth channel, and the one that can't just queue a reply for later —
a live phone call is happening in real time, so whatever the agent decides
to say has to come back from one HTTP request fast enough to keep the
conversation going. `POST /api/agent/invoices/:id/call` places a real
outbound call via Twilio (verified against the installed `twilio` v9.13.0
Python/Node SDKs, same discipline as the rest of this project) to whichever
button a human clicks "Call them" on — the call itself is driven entirely
by Twilio re-fetching TwiML from this server turn by turn, not by anything
held open server-side:

1. **`POST /api/twilio/voice`** — Twilio fetches this the instant the
   client picks up. The agent doesn't know anything's been said yet
   (there's nothing to react to), so this is framed as the agent's own
   opening turn: introduce yourself, state why you're calling, stop.
2. **`<Gather input="speech">`** — Twilio's own built-in speech-to-text
   transcribes whatever the client says next; no separate STT/TTS service
   needed, Twilio's `<Say>`/`<Gather>` verbs do both ends of that for free.
3. **`POST /api/twilio/voice/gather`** — receives the transcript, asks the
   same negotiation logic email/WhatsApp/SMS replies use what happens next,
   and speaks the answer. `actionOnEmptyResult="true"` means even silence
   routes back through this one webhook (confirmed against Twilio's own
   docs — without it, a silent Gather just falls through to the next TwiML
   verb and never calls back at all) so there's a single place that decides
   what a silent turn means: one re-prompt, then a graceful hang-up,
   without spending any of the call's turn budget or an LLM call on dead
   air.

Reusing the existing negotiate agent (not a separate one) was the point,
not a shortcut — `agent/execute.py`'s `handle_voice_turn` builds the same
full conversation thread used for text replies and hands it to the exact
same `build_negotiate_agent()`, so a client who gets called about an
invoice they were already emailed about has the agent reference that
history naturally, and a client who negotiates a payment plan over the
phone gets the exact same real PayPal order/multi-installment tracking a
negotiated email reply would produce. Only the *style* differs, via
phone-specific prompt instructions: 1-3 short spoken sentences, no
markdown, and — this is the constraint that actually shaped the
implementation — **never read a URL out loud**. A spoken link is unusable,
so the moment the agent mints a payment link mid-call, Python fires a real
text with that link (reusing Phase 4's `send_text_message`) instead of
speaking it, and the agent's spoken line says "I'll text that to you right
now" — a promise the system keeps automatically rather than one the LLM
just happens to say. Every turn — agent and client, however many channels
a thread has crossed — lands in the exact same conversation record
(`channel: "phone"`) the "Still talking it out" panel already renders, so
a live call shows up right alongside email/WhatsApp/SMS threads with zero
UI-side special-casing.

A call is capped at `MAX_VOICE_TURNS` (6) agent turns, after which it wraps
up and hangs up regardless of where the conversation was — a client who
just keeps talking shouldn't be able to run up an unbounded number of LLM
calls on one phone call. Like every other real-send path here, this
degrades gracefully with Twilio unconfigured: `POST /api/agent/invoices/:id/call`
returns a `stubbed` result instead of erroring, and `GET /api/twilio/status`'s
`voice_call_configured` tells the UI which case to expect. Voice calls
reuse the same `TWILIO_SMS_FROM` number as the caller ID — one Twilio
number handles SMS and Voice by default, so there's no separate number to
provision.

**Current status: stubbed, not live.** Unlike WhatsApp (moved to Meta's
Cloud API above), there's no free equivalent for placing real phone calls —
every telephony provider charges for connecting to the real phone network,
Twilio included, so this stays `status='stubbed'` on the deployed demo
rather than spending real money on a feature with no free-tier path. The
whole flow above is real, implemented, and covered by 12 passing tests and
a full curl-simulated smoke test of every branch (opening turn, speech,
silence/re-prompt, turn cap, hangup) — it's genuinely ready the moment a
Twilio number is added to the environment, just not wired to one right now.

## What's here

```
agent/
├── models.py        Pydantic schemas for structured node outputs
├── tools/
│   ├── risk.py           calculate_risk_score — ported from riskEngine.js
│   ├── probability.py    predict_payment_probability — ported from probabilityEngine.js
│   ├── paypal_tools.py   create_paypal_order / get_paypal_order_status — PayPal's own Agent Toolkit
│   ├── whatsapp_tools.py send_whatsapp_message — real WhatsApp via Meta's Cloud API directly
│   └── sms_tools.py      send_text_message — SMS via Twilio (no number configured; stubbed)
├── agents.py         Per-node Agent definitions (model, tools, prompts)
├── graph.py          The actual strands.multiagent.Graph wiring
├── execute.py        Phase 2: approve → send → reflect (post-graph)
└── inbox.py          IMAP polling + reply parsing for the negotiation loop
tests/                 pytest suite — risk/probability/branch logic, client memory, negotiation
run_demo.py           End-to-end runnable example
smoke_test.py         Verifies everything imports/builds without a real API key
requirements.txt
```

## Setup

```bash
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

## Run the smoke test first (no API key needed for this part)

```bash
python smoke_test.py
```

This proves the pure-Python risk/probability logic is correct and
that the Graph/Agents construct without error — useful for iterating
fast without burning API credits, and exactly what to run again the
moment your Bedrock access clears (just swap the model, see below).

## Run the test suite

```bash
pip install pytest
pytest
```

`tests/` covers the deterministic, model-free parts of the agent in
detail — `calculate_risk_score` and `predict_payment_probability`
(every per-factor cap, every category boundary, on both sides), the
plan/branch decision in mock mode (no_action / standard / escalation,
including the cases where risk and probability pull in opposite
directions), and the client-memory layer (score clamping, seeding a
new client from the invoice, message-history ordering). No API key
and no network calls — these run in under two seconds. A
`conftest.py` fixture points every test's memory/history files at a
throwaway temp directory, so running the suite never touches
`agent/data/*.json` (the files the actual running demo reads and
writes).

## Run it with zero cost — mock mode

No API key, no credits, nothing to wait on:

```bash
python run_demo.py --mock
```

This runs the exact same shape of output (`RiskAssessment`,
`ActionPlan`, `DraftedMessage`, `Reflection` — see `agent/mock.py`)
through deterministic Python instead of an LLM graph. It won't write
you a genuinely reasoned, tone-matched message — the draft is a
templated fill-in-the-blank, clearly labeled `[MOCK]` throughout — but
it's enough to build and test your Approval Gate UI, Express routes,
and frontend wiring against real data shapes today. Nothing downstream
needs to change when you switch to real mode later.

## Run the real end-to-end demo

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # console.anthropic.com
python run_demo.py
```

This runs a seed invoice through risk_assess and probability (in
parallel — they're both entry points with no dependencies), fans
into plan, and conditionally drafts a message — then simulates a
human approving it and runs the reflection step.

## How the Graph actually works (verified, not assumed)

- **Entry points are automatic.** `risk_assess` and `probability` have
  no incoming edges, so Strands runs them in parallel without you
  calling `set_entry_point()` explicitly.
- **Data flows between nodes automatically.** When `plan` runs,
  Strands concatenates the *structured output* of `risk_assess` and
  `probability` (as JSON) into `plan`'s input alongside the original
  task. You don't wire this by hand — it's `_build_node_input` in the
  SDK.
- **The conditional edge is real.** `plan → draft` only fires if the
  plan agent's structured output has `branch != "no_action"`. If a
  client's payment probability is high enough (>= 85 in the current
  prompt), the graph stops after `plan` and never drafts a message —
  the agent choosing *not* to act, not just a linear pipeline. This is
  the thing to point a judge at.
- **structured_output_model is what makes conditionals possible.**
  Every node returns a validated Pydantic object
  (`RiskAssessment`, `ActionPlan`, etc. — see `models.py`), not free
  text, so `graph.py`'s condition function can read
  `state.results["plan"].result.structured_output.branch` reliably.

## Switching to Bedrock (once your Bedrock access clears)

Only `agent/agents.py`'s `get_model()` function needs to change:

```python
from strands.models import BedrockModel

def get_model():
    return BedrockModel(
        model_id="anthropic.claude-sonnet-4-6-...",  # check the Bedrock model catalog for the exact ID
        region_name="us-east-1",
    )
```

Nothing else — not `graph.py`, not `agents.py`'s node definitions —
needs to change. That's deliberate: it's what let you start building
today on the Anthropic API while your AWS support case was still in
queue, and move to Bedrock/AgentCore later for the bonus scoring
without a rewrite.

## What's intentionally not here yet

- **No Twilio number configured, so SMS and voice calls stay stubbed on
  the live demo** — a real Twilio number usable via the REST API now
  requires upgrading to a paid account (Twilio's free tier only offers a
  console-only "Try out" demo that doesn't support custom webhooks), and
  plain SMS to Indian numbers separately runs into TRAI's DLT
  sender-registration requirement regardless of provider. Both the SMS
  path (`agent/tools/sms_tools.py`) and the voice call flow ("AI voice
  calls" above) are fully built and tested, just not wired to live
  credentials — see that section for voice specifically.
- **Business-initiated WhatsApp templates** — Meta requires a
  pre-approved message template for any WhatsApp send that doesn't fall
  inside the client's 24-hour reply window (see "WhatsApp & SMS" above).
  Getting one approved needs time this project didn't spend, so first-touch
  outreach to a phone-only client currently fails with Meta's own error
  rather than silently succeeding — reported honestly (`status='failed'`),
  not glossed over. Replying to a client who's already messaged in, which
  is the actual demo path, works today with zero template needed.
- **Inbound voice calls** — only outbound is wired up (a human clicks "Call
  them"); a client calling the demo number back would need its own TwiML
  entry point. Reasonable for a collections agent that initiates contact,
  but worth naming as a gap rather than an oversight.
- **AgentCore Runtime / Bedrock deployment** — the model-provider switch
  in `agents.py` (see "Switching to Bedrock" above) means no code change
  is needed to move off the Anthropic/Gemini API, but this hasn't
  actually been deployed to Bedrock AgentCore Runtime for the bonus
  scoring track.
