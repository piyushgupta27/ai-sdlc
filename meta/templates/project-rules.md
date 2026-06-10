## ai-sdlc managed rules

> Managed by `sdlc onboard` / `sdlc doctor`. Do **not** hand-edit between the
> `ai-sdlc:rules` markers — changes are overwritten from the canonical source in
> ai-sdlc (`meta/templates/project-rules.md`). To change a rule, edit the source.

- **Reviewer-facing output leads with the decision.** PRs, escalations, findings, status updates: open with the decision/answer + recommendation, plain-first, scannable (short bullets, minimal jargon); put depth below. A dense wall of text is a failure even when "structured." The reader is a manager + dev — impact-first framing with enough technical anchor.
- **Testbed duty.** When work surfaces an ai-sdlc platform gap (onboarding miss, gate false-positive, prompt weakness), document it exhaustively + without bias — what / why it matters / evidence / suggested fix — as an ai-sdlc issue. The platform enforces systematically; testbeds report gaps diligently; neither is assumed correct.
- **Pipeline artifacts stay gitignored.** `.audit/` and `.sdlc-queue/` are written into the working tree by the pipeline; they must remain gitignored so deterministic gates don't fail on the pipeline's own output.
