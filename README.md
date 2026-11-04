# CollectAI Agent Service — Strands starter kit

This is a real, tested Strands Agents implementation of the risk →
probability → plan → draft sweep described in the hackathon build spec.
Verified against **strands-agents v1.54.0** by installing it and
inspecting the actual API (not written from memory) — every import,
class, and method signature here has been checked against the real
package.

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

## What's here

```
agent/
├── models.py        Pydantic schemas for structured node outputs
├── tools/
│   ├── risk.py           calculate_risk_score — ported from riskEngine.js
│   └── probability.py    predict_payment_probability — ported from probabilityEngine.js
├── agents.py         Per-node Agent definitions (model, tools, prompts)
├── graph.py          The actual strands.multiagent.Graph wiring
└── execute.py        Phase 2: approve → send → reflect (post-graph)
tests/                 pytest suite — risk/probability/branch logic, client memory
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

- **AgentCore Memory** — `agents.py` currently has no persistent
  client memory; each run is stateless. Wire in AgentCore Memory (or
  a Firestore-backed equivalent, per the build spec's porting map)
  once you're deploying to AgentCore Runtime.
- **Real send logic** — `execute.py`'s `send_message()` is a stub that
  prints instead of calling Nodemailer/WhatsApp. Port
  `emailService.js` in when you're ready.
- **The Approval Gate UI** — `execute.py`'s `approve_and_execute()` is
  the function your Express route calls when a human clicks
  Approve/Reject in the dashboard; the UI panel itself isn't part of
  this package.
