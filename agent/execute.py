"""Phase 2: approve -> execute -> reflect.

This runs *after* graph.run_sweep() returns a DraftedMessage and a
human has approved it. It's deliberately not part of the Graph itself
— the approval step needs a human in the loop (your Approval Gate UI
panel calls this), and there's no reason to force that through the
graph's execution model when a plain function does the job clearly.
"""

from .agents import build_reflect_agent
from .models import DraftedMessage, Reflection


def send_message(message: DraftedMessage) -> dict:
    """Stub — replace with real Nodemailer/WhatsApp-API calls (ported
    from the original executionEngine.js / emailService.js) once
    you're past the demo stage."""
    print(f"[SEND via {message.channel}] Subject: {message.subject}")
    print(message.body)
    return {"status": "sent", "channel": message.channel}


def approve_and_execute(message: DraftedMessage, approved: bool, edited_body: str | None = None) -> dict:
    """Called by the Approval Gate UI when the human clicks Approve/Reject.

    Args:
        message: The DraftedMessage from graph.run_sweep().
        approved: True if the human clicked Approve.
        edited_body: If the human edited the draft before approving,
            pass the edited text here — it overrides message.body.

    Returns:
        dict with the execution result and the reflection, or a
        'skipped' status if the human rejected the draft.
    """
    if not approved:
        return {"status": "skipped", "reason": "rejected by human reviewer"}

    if edited_body:
        message = message.model_copy(update={"body": edited_body})

    send_result = send_message(message)

    reflect_agent = build_reflect_agent()
    reflect_result = reflect_agent(
        f"A collections message was just sent.\n"
        f"Channel: {message.channel}\nSubject: {message.subject}\nBody: {message.body}\n"
        f"Send result: {send_result}\n"
        f"(No client response yet — reflect on the decision to send this, its tone, "
        f"and whether the approach fits the situation.)"
    )
    reflection: Reflection = reflect_result.structured_output

    return {"status": "sent", "send_result": send_result, "reflection": reflection}
