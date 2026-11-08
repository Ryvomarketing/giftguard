# GiftGuard: product review and build decisions

GiftGuard addresses the challenge well. The recommended product is a guided weekly review with a persistent assistant: upload, resolve identities, reach out. Speech and typing operate the same actions and show the same review cards. A generic chat-only interface would make Denise remember commands and hide pending work.

## Corrections to the PRD

1. **Missing is not failed.** A missing monthly gift is a signal to investigate. CSV history cannot establish an expired card. Use “Monthly gift missing”; explain a card issue is one possible reason.
2. **Freshness controls certainty.** Detection at five days requires sufficiently current exports. An uploaded file's newest gift does not prove coverage through that date. Show upload time and newest gift separately; staff check source coverage before outreach. Weekly uploads cannot promise detection within five days.
3. **Donors and gifts are different identities.** Merging a donor preserves every original transaction. Prefer source transaction IDs for reimport checks; exact file hashes prevent replay. Preserve identical legitimate gifts and warn on ambiguous overlapping exports. Do not promise perfect transaction dedupe without stable IDs.
4. **Households are not individuals.** Shared surname/address/phone can indicate a household. Different first names remain separate; weak links must not create transitive merges. Every proposed group needs staff review.
5. **Calendar arithmetic matters.** Monthly schedules clamp to month end. On November 7, 2026, a missed December 2025 gift is late; an expected December 2026 gift is not. Seed history spans 2022 onward to establish this.
6. **Purchases are not donation schedules.** Preserve auction/ticket transactions in the history but exclude purchases from recurring-gift inference. No tax-deductibility claims.
7. **Privacy needs precise language.** The database is local. Selected fields go to OpenAI when live AI is used. Disable tracing and response storage. API data is not used for training by default, but that is not a zero-retention guarantee. Audio is not persisted by this app.
8. **Approval is a server invariant.** Expiring one-use proposals bind exact actions and a database revision. A model cannot mint approval. Undo must reject stale dependent merges.
9. **Goals are not demonstrated results.** “Under 10 minutes” and “pennies per run” remain hypotheses until timed user sessions and API usage measurement. Estimated annual giving is not proven money lost.

## Alternatives considered

| Approach | Strength | Limitation | Decision |
|---|---|---|---|
| Guided workspace + narrow AI agents | Visible work, reviewable actions, accessible speech | Requires UI plus reliable core | Recommended |
| Chat-only donor assistant | Flexible conversational entry | Hard to discover pending tasks; audit context gets buried | Assistant supports the workspace |
| Spreadsheet formulas/templates | Low operational complexity | Weak reversible identity linking and voice UX | Useful export/fallback later |
| Full CRM replacement | Broad donor lifecycle | Import migration, integrations and training exceed weekend scope | Keep existing CRM |
| Live payment integration | Actual failed-payment events, timely alerts | Credentials, webhook security and provider differences | Next phase if five-day guarantee required |
| Realtime speech conversation | Natural back-and-forth | More transport/session/turn-handling work | Start tap-to-talk; retain typed correction |

## Interface decisions

A calm workspace with three jobs and a visible Ask GiftGuard panel. Use a tap to start/stop recording, show the transcript, then submit. Avoid a global spacebar shortcut that conflicts with typing or assistive technology. Buttons remain available for every supported action. Show the donor facts beside outreach drafts. “Approve all” lists the exact groups first.

## Build and release scope

Local single-staff demonstration. Synthetic dataset, reversible approvals, CSV/Excel import, deterministic pattern inference, outreach tracking and voice/API integration. No automatic email/calls, check photography or public deployment. SQLite uses Node's built-in driver to avoid a native binary installation dependency in this environment. The requested Agents SDK remains the live integration; absence is disclosed and never imitated.

## Sources checked

- [OpenAI Agents SDK human approval](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/)
- [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data)
- [OpenAI transcription](https://developers.openai.com/api/docs/guides/speech-to-text): requested `gpt-4o-mini-transcribe` remains configurable; current docs mark it deprecated for shutdown February 26, 2027. Evaluate `gpt-transcribe` before long-term deployment.
- [Give Miami Day](https://www.givemiamiday.org/): November 19, 2026 confirmed.
- [Next.js installation](https://nextjs.org/docs/app/getting-started/installation)

## Database and container recommendation

The application already implements persistent SQLite storage. It creates `data/giftguard.sqlite` on first workspace load, including donor records, gifts, approval records, merge history and outreach. No separate PostgreSQL service is required for the current single-staff demo.

For the hackathon, keep the local Node application and SQLite to minimize setup. For a reproducible single-server installation, Docker is useful: one application container, secrets supplied at runtime, and a persistent volume mounted at the configured database directory. The container image must exclude `.env.local`, local donor data and host `node_modules`. A volume protects data through container replacement; it is not a backup. Schedule database-consistent backups before using real records.

Move to managed PostgreSQL when the service needs multiple application instances, substantial simultaneous writes, or centrally managed database availability. That migration requires changes to the SQLite-specific storage layer; it is not just changing the connection string. For hosted multi-user use, replace the shared demo password with proper staff authentication and review the existing in-process session/rate-limit design.

No Docker configuration or PostgreSQL service was created in this recommendation step.

References: [SQLite deployment guidance](https://www.sqlite.org/whentouse.html), [Docker volume persistence](https://docs.docker.com/engine/storage/volumes/).

## UI simplification update

User preference supersedes the original persistent assistant panel: the assistant is now a floating button and a compact conversation window, closed by default. The interface uses monochrome shadcn/Radix controls, Lucide icons and text navigation. Removed decorative marketing sections and redundant descriptions; optional context lives in accessible help tooltips and collapsed details. Important warnings, unresolved import questions and exact approval details remain visible.

Voice is a bounded chain: STT, the same Command agent, then optional TTS. Short recent conversation and one selected donor support follow-ups without letting chat history approve mutations. Closing the widget cancels microphone, requests and audio. Muting spoken replies affects output only; Stop controls recording. Existing Speech API models serve this weekend demo; migrate to the official Realtime workflow before the documented shutdown dates. No change to donor storage or merge semantics.

## Live voice correction (supersedes the turn-by-turn voice decision)

The user explicitly wants a persistent two-way voice connection. Replaced clip transcription plus separate speech synthesis with OpenAI Realtime over WebRTC. One click connects the microphone and remote audio; automatic semantic turn detection and interruptions support back-and-forth conversation until the user ends it. The floating panel remains optional and does not occupy the main workspace. Removed the prior recording/transcript/send UI and its unused endpoints.

Backend tools only read facts, draft notes, or create exact review proposals. Changes remain server-approved; speaking “yes” cannot commit them. The microphone pauses for approval while the connection remains alive. Direct voice transport uses the OpenAI Realtime API independently of the optional typed/import/drafting Agents SDK. The previous Speech API deprecation concern no longer applies to the active live-voice path.

## Visible work inspired by Stitch

Google's May 19, 2026 announcement describes live canvas streaming and the ability to steer iterations before completion. The useful adaptation for GiftGuard is visibility into work on actual donor records. A labeled cursor/focus outline follows genuine tool start/result events, rather than simulating a design canvas or pretending to click controls. No typing animation is used to misrepresent a completed draft as live model streaming. The feature stays within the monochrome interface, is optional, and respects reduced-motion preferences. Approval details remain readable and require a human action.

Source: [Google's Stitch live-design announcement](https://blog.google/innovation-and-ai/models-and-research/google-labs/stitch-updates/).
