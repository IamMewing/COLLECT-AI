"""Tests for agent/tools/whatsapp_tools.py — real WhatsApp sending via
Meta's Cloud API (graph.facebook.com directly, no Twilio involved).

No real network call is made: send_whatsapp_message() builds its request
via the `requests` module, so a fake `requests.post` standing in for the
real HTTP call exercises the real payload-building and response-handling
logic (the part this project's own code is responsible for) without
needing real Meta credentials or network access — same trade-off
test_sms_tools.py/test_paypal_tools.py make for their own third-party
clients.
"""

import agent.tools.whatsapp_tools as wt


class _FakeResponse:
    def __init__(self, status_code, json_data, text=""):
        self.status_code = status_code
        self._json_data = json_data
        self.content = b"x" if json_data is not None else b""
        self.text = text

    def json(self):
        return self._json_data


# ── Not configured ─────────────────────────────────────────────────────────


def test_send_without_meta_configured_falls_back_to_a_successful_stub(monkeypatch):
    monkeypatch.delenv("META_WHATSAPP_ACCESS_TOKEN", raising=False)
    monkeypatch.delenv("META_WHATSAPP_PHONE_NUMBER_ID", raising=False)

    result = wt.send_whatsapp_message("+15558675310", "hello")

    assert result["status"] == "sent"
    assert result["channel_used"] == "whatsapp"
    assert result["real_send"] is False
    assert result["message_sid"] is None


def test_is_configured_reflects_both_required_env_vars(monkeypatch):
    monkeypatch.delenv("META_WHATSAPP_ACCESS_TOKEN", raising=False)
    monkeypatch.setenv("META_WHATSAPP_PHONE_NUMBER_ID", "123456")
    assert wt.is_configured() is False

    monkeypatch.setenv("META_WHATSAPP_ACCESS_TOKEN", "token")
    assert wt.is_configured() is True


# ── Real send: success ─────────────────────────────────────────────────────


def test_successful_send_posts_the_documented_payload_shape(monkeypatch):
    monkeypatch.setenv("META_WHATSAPP_ACCESS_TOKEN", "fake-token")
    monkeypatch.setenv("META_WHATSAPP_PHONE_NUMBER_ID", "1122334455")

    captured = {}

    def fake_post(url, headers=None, json=None, timeout=None):
        captured["url"] = url
        captured["headers"] = headers
        captured["json"] = json
        return _FakeResponse(200, {
            "messaging_product": "whatsapp",
            "contacts": [{"input": "919876543210", "wa_id": "919876543210"}],
            "messages": [{"id": "wamid.ABC123"}],
        })

    monkeypatch.setattr(wt.requests, "post", fake_post)

    result = wt.send_whatsapp_message("+91 98765-43210", "Your invoice is overdue.", opens_session=True)

    assert result["status"] == "sent"
    assert result["real_send"] is True
    assert result["message_sid"] == "wamid.ABC123"
    assert captured["url"] == f"https://graph.facebook.com/{wt.GRAPH_API_VERSION}/1122334455/messages"
    assert captured["headers"]["Authorization"] == "Bearer fake-token"
    # Recipient normalized to digits only, country code kept, no '+'/spaces/dashes.
    assert captured["json"]["to"] == "919876543210"
    assert captured["json"]["type"] == "text"
    assert captured["json"]["text"]["body"] == "Your invoice is overdue."


def test_opens_session_does_not_change_the_request_shape(monkeypatch):
    # Unlike the old Twilio path, this module never branches on
    # opens_session itself — Meta's API is the one that decides whether the
    # send is actually allowed right now (see the module docstring).
    monkeypatch.setenv("META_WHATSAPP_ACCESS_TOKEN", "fake-token")
    monkeypatch.setenv("META_WHATSAPP_PHONE_NUMBER_ID", "1122334455")

    requests_made = []

    def fake_post(url, headers=None, json=None, timeout=None):
        requests_made.append(json)
        return _FakeResponse(200, {"messages": [{"id": "wamid.X"}]})

    monkeypatch.setattr(wt.requests, "post", fake_post)

    wt.send_whatsapp_message("+15558675310", "opening message", opens_session=False)
    wt.send_whatsapp_message("+15558675310", "a reply", opens_session=True)

    assert requests_made[0]["type"] == requests_made[1]["type"] == "text"


# ── Real send: failure ──────────────────────────────────────────────────


def test_meta_error_response_is_reported_as_a_failed_status_not_raised(monkeypatch):
    monkeypatch.setenv("META_WHATSAPP_ACCESS_TOKEN", "fake-token")
    monkeypatch.setenv("META_WHATSAPP_PHONE_NUMBER_ID", "1122334455")

    def fake_post(url, headers=None, json=None, timeout=None):
        # Meta's documented shape for e.g. "re-engagement message outside
        # the allowed window" (code 131047) or a missing template (131026).
        return _FakeResponse(400, {
            "error": {
                "message": "Message failed to send because more than 24 hours have passed "
                           "since the customer last replied to this number.",
                "type": "OAuthException",
                "code": 131047,
            }
        })

    monkeypatch.setattr(wt.requests, "post", fake_post)

    result = wt.send_whatsapp_message("+15558675310", "hi", opens_session=False)

    assert result["status"] == "failed"
    assert result["real_send"] is False
    assert result["message_sid"] is None
    assert "131047" in result["error"]


def test_network_exception_is_reported_as_a_failed_status_not_raised(monkeypatch):
    monkeypatch.setenv("META_WHATSAPP_ACCESS_TOKEN", "fake-token")
    monkeypatch.setenv("META_WHATSAPP_PHONE_NUMBER_ID", "1122334455")

    def fake_post(url, headers=None, json=None, timeout=None):
        raise ConnectionError("connection reset")

    monkeypatch.setattr(wt.requests, "post", fake_post)

    result = wt.send_whatsapp_message("+15558675310", "hi")

    assert result["status"] == "failed"
    assert result["real_send"] is False
    assert "connection reset" in result["error"]
