# PayPal sandbox setup (for the PayPal AI Hackathon build)

CollectAI integrates PayPal's Orders (Checkout) API + Webhooks so the
agent's decision to act becomes a real, payable sandbox PayPal link, and a
real payment event (not a human clicking a button) closes the loop. This
doc is the step-by-step to get your own sandbox credentials. Everything
here is free and uses PayPal's sandbox — no real money moves.

## Why Orders API instead of Invoicing

This was originally built against PayPal's Invoicing API. During setup we
hit a PayPal sandbox-side issue: the OAuth token's granted scope never
included an invoicing permission, no matter what we tried — enabling the
"Invoicing" capability checkbox on the app, recreating the app from
scratch, creating a brand-new sandbox Business account in a different
country, and rotating the client secret. All consistently returned `403
NOT_AUTHORIZED` on `POST /v2/invoicing/invoices` with an OAuth token that
worked fine everywhere else. That points to a stuck/cached permission set
on PayPal's side for that developer account, not anything fixable from the
dashboard.

Rather than block the submission on PayPal's sandbox clearing on its own
schedule, the integration was rebuilt on the **Orders v2 (Checkout) API**,
which worked immediately with the exact same credentials. This is the same
agentic-commerce story — the agent autonomously creates a real, payable
PayPal link for a specific amount, woven directly into its drafted
message — and it's the API PayPal's own docs recommend for
agent/checkout-style integrations generally.

## 1. Create a developer.paypal.com account

1. Go to https://developer.paypal.com/ and log in with an existing PayPal
   account, or create one.
2. You'll land on the Developer Dashboard. PayPal auto-creates two sandbox
   test accounts for you under **Sandbox → Accounts**:
   - a **Business** account (acts as the merchant — this is "CollectAI")
   - a **Personal** account (acts as the buyer/client — this is who "pays"
     the order during your demo)

   Note the Personal account's email — that's your `PAYPAL_DEMO_BUYER_EMAIL`
   (used only so you know which sandbox account to log into and pay with
   during the demo — it isn't sent to PayPal's API). You can log into
   https://sandbox.paypal.com with that sandbox account (use "View/edit
   account" in the dashboard to see its generated password) to actually
   click "Pay Now" during your demo video.

## 2. Create a sandbox app (get your Client ID / Secret)

1. In the Developer Dashboard, go to **Apps & Credentials**.
2. Make sure the **Sandbox** toggle is selected (not Live).
3. Click **Create App**, name it e.g. `CollectAI`.
4. Copy the **Client ID** and **Secret** shown — these go into
   `server/.env` as `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`.

(If you ever do need a feature that's gated behind one of the "Payment
capabilities" checkboxes further down the app page, check the box, hit
**Save Changes**, and — based on what we saw — also **regenerate the
client secret** afterward. PayPal appears to cache the token's granted
scope at the credential level for its full ~9 hour lifetime, so an old
token/secret can keep reporting the pre-change permission set even after
the checkbox is saved.)

## 3. Fill in server/.env

```bash
cd server
cp .env.example .env
```

Then edit `.env` and set at minimum:

```
PAYPAL_CLIENT_ID=<from step 2>
PAYPAL_CLIENT_SECRET=<from step 2>
PAYPAL_DEMO_BUYER_EMAIL=<the sandbox Personal account's email from step 1>
```

With just these set, approving a drafted message now creates a real
sandbox PayPal order and weaves the real approval/payment link into the
message. You can check it worked via `GET /api/paypal/status`.

## 4. (Optional but recommended) Wire up the webhook

This is what makes the loop close automatically — PayPal tells your server
the moment the client approves and the payment is captured, instead of you
clicking "mark paid" by hand.

1. Run the server locally (`npm run dev` in `server/`).
2. Expose it to the internet temporarily, e.g. with ngrok:
   ```bash
   ngrok http 3001
   ```
   Copy the `https://....ngrok-free.app` URL it gives you.
3. In the Developer Dashboard, open your app (from step 2) → **Webhooks**
   → **Add Webhook**.
4. Webhook URL: `https://<your-ngrok-url>/api/paypal/webhook`
5. Subscribe to at least: `CHECKOUT.ORDER.APPROVED`.
6. Save, then copy the **Webhook ID** it gives you into `server/.env` as
   `PAYPAL_WEBHOOK_ID`.

Now: approve a draft → open the real payment link that got woven into the
message → log in as the sandbox Personal account at sandbox.paypal.com and
click "Pay Now" → the webhook fires, the server captures the payment
server-side, and your server log automatically marks the invoice paid and
runs the agent's reflection, with zero manual intervention. **That moment
is the thing to put front-and-center in the demo video.**

## 5. For the final submission

- Keep `PAYPAL_ENV=sandbox` — that's required (no purchase/real payment
  necessary to enter).
- If judges will run this themselves rather than watch a hosted demo, the
  repo README's run instructions need to mention they'll need their own
  sandbox credentials (same steps as above) — the Hackathon rules explicitly
  allow satisfying "functional demo" via clear setup/run instructions.
- Before final submission, tighten `server.js`'s webhook handler to reject
  unverified events (currently it logs a warning and still processes them,
  which is convenient while `PAYPAL_WEBHOOK_ID` isn't set yet during local
  dev, but shouldn't ship that way).
