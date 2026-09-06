"""Verifies the package imports cleanly, the pure-Python tools produce
sane output, and the Graph/Agents construct without error — all
without making any real network calls (no valid API key needed)."""

import os
os.environ.setdefault("ANTHROPIC_API_KEY", "sk-ant-smoketest-placeholder")

print("1. Importing agent package...")
import agent  # noqa: E402
print("   OK\n")

print("2. Testing calculate_risk_score directly...")
from agent.tools.risk import calculate_risk_score
r = calculate_risk_score(days_overdue=34, amount=185000, ignored_reminders=2, relationship_score=62)
print(f"   {r}")
assert 0 <= r["score"] <= 100
assert r["category"] in ("Low", "Medium", "High", "Critical")
print("   OK\n")

print("3. Testing predict_payment_probability directly...")
from agent.tools.probability import predict_payment_probability
p = predict_payment_probability(days_overdue=34, ignored_reminders=2, relationship_score=62, historical_on_time_rate=0.55)
print(f"   {p}")
assert 0 <= p["probability"] <= 100
print("   OK\n")

print("4. Testing a Low-risk, high-probability invoice (should skip messaging)...")
r2 = calculate_risk_score(days_overdue=2, amount=15000, ignored_reminders=0, relationship_score=95)
p2 = predict_payment_probability(days_overdue=2, ignored_reminders=0, relationship_score=95, historical_on_time_rate=0.95)
print(f"   risk={r2}  probability={p2}")
print("   OK\n")

print("5. Constructing all Agents (no network call happens at construction time)...")
from agent.agents import build_risk_agent, build_probability_agent, build_plan_agent, build_draft_agent, build_reflect_agent
build_risk_agent()
build_probability_agent()
build_plan_agent()
build_draft_agent()
build_reflect_agent()
print("   OK\n")

print("6. Building the Graph (wires nodes + edges, no network call)...")
from agent.graph import build_graph
g = build_graph()
print(f"   Graph built: {type(g).__name__}")
print("   OK\n")

print("ALL SMOKE TESTS PASSED — package structure and logic are sound.")
print("Set a real ANTHROPIC_API_KEY and run `python run_demo.py` for a live end-to-end run.")
