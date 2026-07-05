# Reports

Generated 2026-07-03 – 2026-07-05, from direct source inspection of the app as it stood at that time. Regenerate rather than hand-edit if the app changes materially.

| # | Report | Covers |
|---|---|---|
| 01 | [Comprehensive Technical Report](01-Comprehensive-Technical-Report.pdf) | Every page/feature, full API + dispatch algorithm, DB schema, routing/traffic sim, AI features, security, testing, deployment pipeline, known gaps |
| 02 | [AI Features, MCP & Security Report](02-AI-Features-MCP-Security-Report.pdf) | Focused deep-dive on VoiceAgent, Open Knowledge Format, MCP integration, the policy-agent vs. RAG distinction, and security controls |
| 03 | [UI/UX Audit Report](03-UIUX-Audit-Report.pdf) | Segment-by-segment review of every page, button, redirect, and container — problems found and fixes (the fixes have since been applied; see git log) |
| 04 | [Playwright Test Report](04-Playwright-Test-Report.pdf) | `tests/playwright` suite results |
| 05 | [Selenium Test Report](05-Selenium-Test-Report.pdf) | `tests/selenium` suite results |
| 06 | [Smoke Test Report](06-Smoke-Test-Report.pdf) | `tests/smoke` suite results — real backend liveness + frontend render checks |

Test report PDFs (04–06) are snapshots of one run. Re-run the corresponding suite under `tests/` and regenerate via `tests/reports/make-report.cjs <playwright|selenium|smoke>` for current results.
