"""PayPal tools for the negotiate agent, built on PayPal's own official
Agent Toolkit (`paypal-agent-toolkit` on PyPI) rather than hand-rolled HTTP
calls — verified against v1.11.0 by installing it and reading the actual
source in site-packages (same standard the rest of this codebase holds
itself to for Strands — see README's "not written from memory" note), not
assumed from documentation or training data.

Scope: Orders only (create_order, capture_order, get_order_details) — the
same API family server/paypalService.js already uses successfully for the
sweep/approve flow. The toolkit also ships Invoicing tools, but those call
`/v2/invoicing/invoices`, which already returned a persistent sandbox-side
403 NOT_AUTHORIZED for this project's PayPal developer account regardless of
app configuration (see PAYPAL_SETUP.md) — wiring those up here would almost
certainly fail the same way, so they're deliberately left out.

Why this is a separate integration from server/paypalService.js rather than
a replacement for it: that Node module is the proven, already-tested path
for the main sweep -> draft -> human-approves -> order-created flow, and
changing working code there risks regressing it for no real gain. This
module exists for the autonomous negotiation loop specifically (see
agent/execute.py's handle_incoming_reply via build_negotiate_agent in
agents.py) — new functionality that never had PayPal access at all before,
where the right agentic-commerce story is the LLM calling PayPal's own tool
directly mid-conversation to mint a real link for whatever amount it just
negotiated, not a token it hands back for other code to fill in later.

Order mappings created here are written to the SAME place
server/store.js reads from for the PayPal webhook handler (server/server.js)
to resolve an incoming CHECKOUT.ORDER.APPROVED event back to an invoice —
same collection name / same local JSON file path, same FIRESTORE_ENABLED
flag — so a negotiation-minted order closes the loop through the existing,
already-tested webhook -> capture -> mark-paid -> reflect pipeline with zero
changes needed on the Node side.
"""

import json
import os
import sys
from pathlib import Path
from typing import Any

from strands import tool
from paypal_agent_toolkit.shared.api import PayPalAPI
from paypal_agent_toolkit.shared.configuration import Context

# Mirrors server/store.js's PAYPAL_ORDERS_PATH exactly (server/paypal_orders.json)
# so the Node webhook handler finds mappings this module writes without any
# changes on that side.
_ORDERS_MAPPING_PATH = Path(__file__).resolve().parent.parent.parent / "server" / "paypal_orders.json"

FIRESTORE_ENABLED = os.environ.get("FIRESTORE_ENABLED", "false").strip().lower() in ("true", "1", "yes")

_firestore_client = None
if FIRESTORE_ENABLED:
    try:
        from google.cloud import firestore as _firestore  # noqa: N812

        _firestore_client = _firestore.Client()
    except Exception as e:  # noqa: BLE001 - degrade to local JSON, same as every other module here
        # Same reasoning as agent/memory.py's module-level print: this runs
        # at import time, before agent_bridge.py's main() redirects stdout
        # to stderr, so it has to name stderr explicitly or it corrupts the
        # bridge's JSON response on stdout.
        print(
            f"[PAYPAL_TOOLS] FIRESTORE_ENABLED=true but Firestore client init failed ({e}). Using local JSON file.",
            file=sys.stderr,
            flush=True,
        )
        _firestore_client = None


def _save_order_mapping(
    paypal_order_id: str,
    invoice_id: str,
    client_name: str,
    kind: str = "full_invoice",
    installment_index: int | None = None,
) -> None:
    """kind distinguishes, for server.js's webhook handler, whether capturing
    this order should close out the whole invoice ('full_invoice' — the
    default, and the only shape Node's own order creation ever wrote before
    this module existed) or just one installment of a multi-payment plan
    ('plan_installment', with installment_index set) — see
    save_installment_order_mapping below, agent/memory.py's update_installment,
    and server.js's webhook branch."""
    mapping: dict[str, Any] = {"invoice_id": invoice_id, "client_name": client_name, "kind": kind}
    if installment_index is not None:
        mapping["installment_index"] = installment_index
    if _firestore_client is not None:
        try:
            _firestore_client.collection("paypal_orders").document(paypal_order_id).set(mapping)
            return
        except Exception as e:  # noqa: BLE001 - fall through to local JSON, don't crash the agent run
            print(f"[PAYPAL_TOOLS] Firestore write failed ({e}) — falling back to local JSON file.", flush=True)

    try:
        existing: dict[str, Any] = {}
        if _ORDERS_MAPPING_PATH.exists():
            existing = json.loads(_ORDERS_MAPPING_PATH.read_text(encoding="utf-8"))
        existing[paypal_order_id] = mapping
        _ORDERS_MAPPING_PATH.parent.mkdir(parents=True, exist_ok=True)
        _ORDERS_MAPPING_PATH.write_text(json.dumps(existing, indent=2, ensure_ascii=False), encoding="utf-8")
    except Exception as e:  # noqa: BLE001 - a logging failure must never break order creation
        print(f"[PAYPAL_TOOLS] Warning: failed to record order mapping ({e}).", flush=True)


def _build_api() -> "PayPalAPI | None":
    """Lazily builds the PayPal Agent Toolkit client from the SAME env vars
    server/paypalService.js already uses (PAYPAL_CLIENT_ID/SECRET/ENV) — one
    set of PayPal credentials for the whole app, not a second config to
    maintain. Returns None (not an exception) if not configured, so a tool
    call degrades to a clear error result instead of crashing the agent."""
    client_id = os.environ.get("PAYPAL_CLIENT_ID")
    secret = os.environ.get("PAYPAL_CLIENT_SECRET")
    if not (client_id and secret):
        return None
    sandbox = os.environ.get("PAYPAL_ENV", "sandbox").strip().lower() != "live"
    return PayPalAPI(client_id=client_id, secret=secret, context=Context(sandbox=sandbox))


def save_installment_order_mapping(
    paypal_order_id: str, invoice_id: str, client_name: str, installment_index: int
) -> None:
    """Plain Python helper (not an LLM tool) — agent/execute.py calls this to
    re-tag an order's mapping as belonging to one specific installment of a
    payment plan, either right after the negotiate agent creates installment
    0's order inline, or after process_due_installments creates a later
    one's order directly. Overwrites whatever _save_order_mapping wrote by
    default (kind='full_invoice'), since the agent's own create_paypal_order
    tool call has no way to know in advance it's part of a multi-installment
    plan — that only becomes clear once the whole NegotiationTurn comes back."""
    _save_order_mapping(
        paypal_order_id, invoice_id=invoice_id, client_name=client_name,
        kind="plan_installment", installment_index=installment_index,
    )


@tool
def create_paypal_order(invoice_id: str, client_name: str, amount_usd: float, description: str) -> dict:
    """Create a real PayPal (sandbox, unless PAYPAL_ENV=live) order for an
    agreed amount and get back a real, payable approval link — use this once
    you and the client have actually agreed on a number (the full balance, a
    negotiated settlement, or one installment of a plan), to hand them a
    real link rather than just describing a plan in words.

    Args:
        invoice_id: The invoice this order is for, e.g. "INV-1042".
        client_name: The client's name, for the order mapping record.
        amount_usd: The agreed amount in US dollars (PayPal sandbox requires
            USD regardless of the invoice's original currency).
        description: A short line describing what this charge is for, shown
            on the PayPal order (e.g. "First of 3 installments on INV-1042").

    Returns:
        dict with paypal_order_id, payment_link, and status on success, or
        {"error": "..."} if PayPal isn't configured or the call failed —
        never raises, so a PayPal hiccup doesn't crash the conversation.
    """
    api = _build_api()
    if api is None:
        return {"error": "PayPal is not configured (PAYPAL_CLIENT_ID/PAYPAL_CLIENT_SECRET not set)."}

    try:
        response_json = api.run(
            "create_order",
            {
                "currency_code": "USD",
                "items": [
                    {
                        "name": description[:127] or f"Invoice {invoice_id}",
                        "item_cost": round(float(amount_usd), 2),
                        "tax_percent": 0,
                        "item_total": round(float(amount_usd), 2),
                        "quantity": 1,
                    }
                ],
                "notes": f"CollectAI negotiated order for invoice {invoice_id}",
            },
        )
        order = json.loads(response_json)
    except Exception as exc:  # noqa: BLE001 - never let a PayPal failure crash the negotiation turn
        print(f"[PAYPAL_TOOLS] create_order failed for {invoice_id} ({exc}).", flush=True)
        return {"error": f"PayPal order creation failed: {exc}"}

    payment_link = next((link.get("href") for link in order.get("links", []) if link.get("rel") == "approve"), None)
    paypal_order_id = order.get("id")

    if paypal_order_id:
        _save_order_mapping(paypal_order_id, invoice_id=invoice_id, client_name=client_name)

    return {
        "paypal_order_id": paypal_order_id,
        "payment_link": payment_link,
        "status": order.get("status", "CREATED"),
    }


@tool
def get_paypal_order_status(paypal_order_id: str) -> dict:
    """Check a previously created PayPal order's current status (e.g.
    CREATED, APPROVED, COMPLETED) — use this if you need to confirm whether
    a link you already sent has been acted on before deciding what to say
    next, rather than assuming.

    Args:
        paypal_order_id: The order id returned by create_paypal_order.

    Returns:
        dict with the order's status, or {"error": "..."} on failure.
    """
    api = _build_api()
    if api is None:
        return {"error": "PayPal is not configured (PAYPAL_CLIENT_ID/PAYPAL_CLIENT_SECRET not set)."}

    try:
        response_json = api.run("get_order_details", {"order_id": paypal_order_id})
        order = json.loads(response_json)
    except Exception as exc:  # noqa: BLE001 - never let a PayPal failure crash the negotiation turn
        print(f"[PAYPAL_TOOLS] get_order_details failed for {paypal_order_id} ({exc}).", flush=True)
        return {"error": f"PayPal order lookup failed: {exc}"}

    return {"paypal_order_id": order.get("id", paypal_order_id), "status": order.get("status", "UNKNOWN")}
