"""Tests for agent/tools/sms_tools.py — real WhatsApp/SMS sending via Twilio.

No real network call is made: send_text_message() builds its client via
_build_client() and calls client.messages.create(...), so a fake client
standing in for twilio.rest.Client exercises the real channel-selection and
response-handling logic (the part this project's own code is responsible
for) without needing real Twilio credentials — same trade-off
test_paypal_tools.py makes for PayPalAPI.
"""

import agent.tools.sms_tools as st


class _FakeMessage:
    def __init__(self, sid="SM123"):
        self.sid = sid
        self.status = "queued"
        self.body = "whatever was sent"


class _FakeMessages:
    def __init__(self, raise_exc=None):
        self.calls = []
        self._raise_exc = raise_exc

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if self._raise_exc:
            raise self._raise_exc
        return _FakeMessage()


class _FakeClient:
    def __init__(self, raise_exc=None):
        self.messages = _FakeMessages(raise_exc=raise_exc)


class _FakeTwilioRestException(Exception):
    def __init__(self, code, msg):
        super().__init__(msg)
        self.code = code
        self.msg = msg


# ── Not configured ─────────────────────────────────────────────────────────


def test_send_without_twilio_configured_falls_back_to_a_successful_stub(monkeypatch):
    monkeypatch.setattr(st, "_build_client", lambda: None)
    result = st.send_text_message("+15558675310", "hello")
    assert result["status"] == "sent"
    assert result["real_send"] is False
    assert result["message_sid"] is None


# ── Channel selection: opens_session controls whatsapp vs. sms ───────────


def test_opens_session_false_sends_sms_when_both_senders_configured(monkeypatch):
    fake = _FakeClient()
    monkeypatch.setattr(st, "_build_client", lambda: fake)
    monkeypatch.setenv("TWILIO_WHATSAPP_FROM", "whatsapp:+14155238886")
    monkeypatch.setenv("TWILIO_SMS_FROM", "+15017122661")

    result = st.send_text_message("+15558675310", "first outreach", opens_session=False)

    assert result["channel_used"] == "sms"
    assert result["real_send"] is True
    call = fake.messages.calls[0]
    assert call["from_"] == "+15017122661"
    assert call["to"] == "+15558675310"
    assert "whatsapp:" not in call["to"]


def test_opens_session_true_sends_whatsapp_when_both_senders_configured(monkeypatch):
    fake = _FakeClient()
    monkeypatch.setattr(st, "_build_client", lambda: fake)
    monkeypatch.setenv("TWILIO_WHATSAPP_FROM", "whatsapp:+14155238886")
    monkeypatch.setenv("TWILIO_SMS_FROM", "+15017122661")

    result = st.send_text_message("+15558675310", "replying to their text", opens_session=True)

    assert result["channel_used"] == "whatsapp"
    call = fake.messages.calls[0]
    assert call["from_"] == "whatsapp:+14155238886"
    assert call["to"] == "whatsapp:+15558675310"


def test_opens_session_false_with_only_whatsapp_configured_still_sends_whatsapp(monkeypatch):
    # Last-resort fallback: no SMS sender on file, so the opening message
    # goes out as WhatsApp anyway rather than being silently dropped — see
    # the module docstring on why this might get rejected by Twilio/Meta
    # outside the session window, and why the except branch handles that.
    fake = _FakeClient()
    monkeypatch.setattr(st, "_build_client", lambda: fake)
    monkeypatch.setenv("TWILIO_WHATSAPP_FROM", "whatsapp:+14155238886")
    monkeypatch.delenv("TWILIO_SMS_FROM", raising=False)

    result = st.send_text_message("+15558675310", "first outreach", opens_session=False)

    assert result["channel_used"] == "whatsapp"
    assert fake.messages.calls[0]["from_"] == "whatsapp:+14155238886"


# ── Failure handling ────────────────────────────────────────────────────


def test_twilio_rest_exception_is_reported_as_a_failed_status_not_raised(monkeypatch):
    exc = _FakeTwilioRestException(code=63016, msg="outside allowed window")
    fake = _FakeClient(raise_exc=exc)
    monkeypatch.setattr(st, "_build_client", lambda: fake)
    monkeypatch.setattr(st, "TwilioRestException", _FakeTwilioRestException)
    monkeypatch.setenv("TWILIO_SMS_FROM", "+15017122661")
    monkeypatch.delenv("TWILIO_WHATSAPP_FROM", raising=False)

    result = st.send_text_message("+15558675310", "hi", opens_session=False)

    assert result["status"] == "failed"
    assert result["real_send"] is False
    assert "63016" in result["error"]
