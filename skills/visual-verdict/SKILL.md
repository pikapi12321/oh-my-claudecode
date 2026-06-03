---
name: visual-verdict
description: Structured visual QA verdict for screenshot-to-reference comparisons
when_to_use: Task includes visual fidelity requirements (layout, spacing, typography, styling); you have a generated screenshot and reference image(s); you need deterministic pass/fail guidance before continuing edits
argument-hint: "<reference image paths and generated screenshot path>"
level: 2
---

<Inputs>
- `reference_images[]` (one or more image paths)
- `generated_screenshot` (current output image)
- Optional: `category_hint` (e.g., `hackernews`, `sns-feed`, `dashboard`)
</Inputs>

<Output_Contract>
Return **JSON only** with this exact shape:

```json
{
  "score": 0,
  "verdict": "revise",
  "category_match": false,
  "differences": ["..."],
  "suggestions": ["..."],
  "reasoning": "short explanation"
}
```

Rules:
- `score`: integer 0-100
- `verdict`: short status (`pass`, `revise`, or `fail`)
- `category_match`: `true` when the generated screenshot matches the intended UI category/style
- `differences[]`: concrete visual mismatches (layout, spacing, typography, colors, hierarchy)
- `suggestions[]`: actionable next edits tied to the differences
- `reasoning`: 1-2 sentence summary

<Threshold_And_Loop>
- Target pass threshold is **90+**.
- If `score < 90`, continue editing and rerun `/oh-my-claudecode:visual-verdict` before any further visual review pass.
- Do **not** treat the visual task as complete until the next screenshot clears the threshold.
</Threshold_And_Loop>

<Debug_Visualization>
When mismatch diagnosis is hard:
1. Keep `$visual-verdict` as the authoritative decision.
2. Use pixel-level diff tooling (pixel diff / pixelmatch overlay) as a **secondary debug aid** to localize hotspots.
3. Convert pixel diff hotspots into concrete `differences[]` and `suggestions[]` updates.
</Debug_Visualization>

<Example>
```json
{
  "score": 87,
  "verdict": "revise",
  "category_match": true,
  "differences": [
    "Top nav spacing is tighter than reference",
    "Primary button uses smaller font weight"
  ],
  "suggestions": [
    "Increase nav item horizontal padding by 4px",
    "Set primary button font-weight to 600"
  ],
  "reasoning": "Core layout matches, but style details still diverge."
}
```
</Example>

Task: {{ARGUMENTS}}
