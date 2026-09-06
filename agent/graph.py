"""The CollectAI recovery-sweep Graph.

Shape:

    risk_assess  \\
                   >--> plan --[condition]--> draft
    probability  /

- risk_assess and probability have no dependencies, so Strands runs
  them as parallel entry points automatically (no manual
  set_entry_point() needed — GraphBuilder infers entry points from
  nodes with zero incoming edges).
- plan depends on both, and Strands auto-concatenates their structured
  outputs (as JSON) into plan's input alongside the original task —
  see _build_node_input in the SDK, this is framework behavior, not
  something we wire by hand.
- The plan -> draft edge is genuinely conditional: if the plan agent
  decides branch == "no_action" (invoice will likely resolve itself),
  the graph stops there and no message is ever drafted. That's the
  agent choosing *not* to act, not just a linear pipeline.

The approval gate, send, and reflection steps happen *after* this
graph returns a DraftedMessage — deliberately outside the graph, in
your application layer (Express/UI), because a human has to see and
approve the draft before anything is sent. See run_demo.py for how
the two phases connect.
"""

from strands.multiagent import GraphBuilder, GraphResult

from .agents import (
    build_risk_agent,
    build_probability_agent,
    build_plan_agent,
    build_draft_agent,
)
from .models import ActionPlan


def _plan_branch(state) -> str | None:
    """Read the ActionPlan.branch value out of the 'plan' node's result, if it ran yet."""
    node_result = state.results.get("plan")
    if node_result is None:
        return None
    structured = node_result.result.structured_output
    if isinstance(structured, ActionPlan):
        return structured.branch
    return None


def build_graph():
    builder = GraphBuilder()

    builder.add_node(build_risk_agent(), "risk_assess")
    builder.add_node(build_probability_agent(), "probability")
    builder.add_node(build_plan_agent(), "plan")
    builder.add_node(build_draft_agent(), "draft")

    builder.add_edge("risk_assess", "plan")
    builder.add_edge("probability", "plan")
    builder.add_edge("plan", "draft", condition=lambda state: _plan_branch(state) != "no_action")

    # This graph has no cycles, but these caps are cheap insurance —
    # they're what stop a misbehaving conditional edge from looping
    # forever and quietly burning through your API credits.
    builder.set_max_node_executions(10)
    builder.set_execution_timeout(120.0)

    return builder.build()


def run_sweep(invoice_task: str) -> GraphResult:
    """Run the risk -> probability -> plan -> (maybe) draft sweep for one invoice.

    Args:
        invoice_task: A plain-text description of the invoice and client,
            including days_overdue, amount, ignored_reminders,
            relationship_score, and historical_on_time_rate — the
            risk/probability tools need these exact fields, so the
            entry-point agents are instructed to extract them from this text.

    Returns:
        GraphResult — inspect .results["draft"] for the DraftedMessage
        (absent if the plan node decided branch == "no_action").
    """
    graph = build_graph()
    return graph(invoice_task)
