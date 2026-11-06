"""Tests for agent/tools/paypal_tools.py — the negotiate agent's PayPal
Orders tools, built on PayPal's own paypal-agent-toolkit package.

No real network call is made: create_paypal_order/get_paypal_order_status
build a PayPalAPI client via _build_api() and call its .run(method, params),
so a fake object standing in for PayPalAPI exercises the real response-
parsing and order-mapping-write logic (the part this project's own code is
responsible for getting right) without needing real sandbox credentials or
reaching the actual PayPal API.
"""

import json

import agent.tools.paypal_tools as pt


class _FakeAPI:
    """Stands in for PayPalAPI: .run(method, params) returns a canned
    PayPal-shaped JSON string, exactly like the real client does
    (see PayPalAPI.run / tool_handlers.create_order, which json.dumps their
    result)."""

    def __init__(self, response_by_method):
        self._response_by_method = response_by_method
        self.calls = []

    def run(self, method, params):
        self.calls.append((method, params))
        return json.dumps(self._response_by_method[method])


# ── Not configured (no PAYPAL_CLIENT_ID/SECRET) ───────────────────────────


def test_create_order_without_credentials_returns_an_error_not_an_exception(monkeypatch):
    monkeypatch.setattr(pt, "_build_api", lambda: None)
    result = pt.create_paypal_order("INV-1", "Acme", 100.0, "test")
    assert "error" in result
    assert "not configured" in result["error"]


def test_get_order_status_without_credentials_returns_an_error_not_an_exception(monkeypatch):
    monkeypatch.setattr(pt, "_build_api", lambda: None)
    result = pt.get_paypal_order_status("5O190127TN364715T")
    assert "error" in result


# ── Successful create_paypal_order: response parsing + order mapping ─────


def test_create_order_extracts_the_approve_link_and_order_id(monkeypatch, tmp_path):
    fake = _FakeAPI({
        "create_order": {
            "id": "PAYPAL-ORDER-123",
            "status": "CREATED",
            "links": [
                {"rel": "self", "href": "https://api.sandbox.paypal.com/v2/checkout/orders/PAYPAL-ORDER-123"},
                {"rel": "approve", "href": "https://www.sandbox.paypal.com/checkoutnow?token=PAYPAL-ORDER-123"},
            ],
        }
    })
    monkeypatch.setattr(pt, "_build_api", lambda: fake)
    monkeypatch.setattr(pt, "_ORDERS_MAPPING_PATH", tmp_path / "paypal_orders.json")

    result = pt.create_paypal_order("INV-5001", "Northwind", 42.50, "Settlement for INV-5001")

    assert result["paypal_order_id"] == "PAYPAL-ORDER-123"
    assert result["payment_link"] == "https://www.sandbox.paypal.com/checkoutnow?token=PAYPAL-ORDER-123"
    assert result["status"] == "CREATED"

    # The exact amount/currency actually sent to PayPal is what this project
    # controls and could regress silently — pin it.
    method, params = fake.calls[0]
    assert method == "create_order"
    assert params["currency_code"] == "USD"
    assert params["items"][0]["item_total"] == 42.50


def test_create_order_writes_the_mapping_the_node_webhook_handler_reads(monkeypatch, tmp_path):
    fake = _FakeAPI({
        "create_order": {
            "id": "PAYPAL-ORDER-999",
            "status": "CREATED",
            "links": [{"rel": "approve", "href": "https://example.com/pay"}],
        }
    })
    mapping_path = tmp_path / "paypal_orders.json"
    monkeypatch.setattr(pt, "_build_api", lambda: fake)
    monkeypatch.setattr(pt, "_ORDERS_MAPPING_PATH", mapping_path)

    pt.create_paypal_order("INV-5002", "Acme Creative", 10.0, "First installment")

    # This file (same path/shape server/store.js's getPaypalOrderMapping
    # reads) is exactly what lets the existing Node webhook handler resolve
    # a CHECKOUT.ORDER.APPROVED event for an order this module created back
    # to the right invoice, with zero changes needed on the Node side.
    saved = json.loads(mapping_path.read_text(encoding="utf-8"))
    assert saved["PAYPAL-ORDER-999"] == {"invoice_id": "INV-5002", "client_name": "Acme Creative"}


def test_create_order_with_no_approve_link_in_response_degrades_gracefully(monkeypatch, tmp_path):
    # A malformed/unexpected PayPal response shouldn't raise — the caller
    # (the negotiate agent, mid-conversation) needs a usable dict either way.
    fake = _FakeAPI({"create_order": {"id": "PAYPAL-ORDER-1", "status": "CREATED", "links": []}})
    monkeypatch.setattr(pt, "_build_api", lambda: fake)
    monkeypatch.setattr(pt, "_ORDERS_MAPPING_PATH", tmp_path / "paypal_orders.json")

    result = pt.create_paypal_order("INV-5003", "Acme", 5.0, "test")
    assert result["payment_link"] is None
    assert result["paypal_order_id"] == "PAYPAL-ORDER-1"


def test_create_order_when_the_api_call_itself_raises_returns_an_error(monkeypatch, tmp_path):
    class _ExplodingAPI:
        def run(self, method, params):
            raise RuntimeError("network boom")

    monkeypatch.setattr(pt, "_build_api", lambda: _ExplodingAPI())
    monkeypatch.setattr(pt, "_ORDERS_MAPPING_PATH", tmp_path / "paypal_orders.json")

    result = pt.create_paypal_order("INV-5004", "Acme", 5.0, "test")
    assert "error" in result
    assert "network boom" in result["error"]


# ── get_paypal_order_status ───────────────────────────────────────────────


def test_get_order_status_returns_the_current_status(monkeypatch):
    fake = _FakeAPI({"get_order_details": {"id": "PAYPAL-ORDER-7", "status": "COMPLETED"}})
    monkeypatch.setattr(pt, "_build_api", lambda: fake)

    result = pt.get_paypal_order_status("PAYPAL-ORDER-7")
    assert result == {"paypal_order_id": "PAYPAL-ORDER-7", "status": "COMPLETED"}
