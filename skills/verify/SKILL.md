---
name: verify
description: Verify that a change really works — delegates to verifier agent
---

Delegate all verification work to the verifier agent:

    Task(subagent_type=”oh-my-claudecode:verifier”, prompt=”Verify: <user request>”)

The verifier agent produces evidence-backed completion checks, test adequacy
analysis, and regression risk assessment.

