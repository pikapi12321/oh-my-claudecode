---
name: verify
description: Verify that a change really works — delegates to verifier agent
when_to_use: You need evidence-backed verification that a change works correctly (test adequacy, regression risk, completion checks)
argument-hint: "<what to verify>"
---

Delegate all verification work to the verifier agent:

    Task(subagent_type=”oh-my-claudecode:verifier”, prompt=”Verify: <user request>”)

The verifier agent produces evidence-backed completion checks, test adequacy
analysis, and regression risk assessment.

