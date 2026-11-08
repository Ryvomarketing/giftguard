# GiftGuard

A guided donor review workspace for Tidepath Family Alliance: upload spreadsheets, review possible duplicates, and reach out to donors whose regular gifts appear late. Denise can use buttons, type a request, or start a live voice conversation.

## Run locally

Requires Node 24 (the application uses built-in SQLite).

```sh
npm install
npm run dev
```

Open http://127.0.0.1:3000. Choose **Explore the sample workspace**, or use the sample password `giftguard-demo`. The app starts with synthetic records dated November 7, 2026. No messages are sent.

If sign-in is rejected, use `http://localhost:3000` and the sample password above. The loopback-origin bug affecting `127.0.0.1` is fixed in the current source. With the development server running, refresh the page; if using `npm start`, stop it, rebuild with `npm run build`, and start it again. A configured `GIFTGUARD_PASSWORD` overrides the sample password. There is no username or OpenAI account login for this demo.

To run the production build:

```sh
npm run build
npm start
```

The development and production servers bind to localhost. The database is `data/giftguard.sqlite`, excluded from version control.

## OpenAI configuration

Copy `.env.example` to `.env.local` if no local configuration exists. Set `OPENAI_API_KEY` on the server. A key's dashboard name is not its environment variable name. Never use a `NEXT_PUBLIC_` prefix for secrets. A local configuration has already been prepared in this workspace; its values are intentionally omitted from documentation.

The typed command, import and drafting AI paths use four `@openai/agents` Agent definitions with structured output: Column Mapper, Matcher, Note Writer and Command. Tracing is disabled, response storage is disabled, inputs are minimized, and calls are bounded. The Command agent returns a constrained intent; application code resolves donor IDs and creates an expiring, single-use confirmation bound to the database revision. **This implementation uses application-level approval, not SDK interruption/resume state.**

The SDK is installed in this workspace (`@openai/agents@0.21.0`) and has been exercised against the sample data with the configured key: the Command agent interprets typed requests and the Note Writer produces the drafts labeled **AI draft**. It remains an optional dependency so deterministic sample workflows stay available if it is absent. To reinstall:

```sh
npm install --save-optional @openai/agents@0.21.0
```

Restart the server after installing or changing `.env.local`. Set `GIFTGUARD_DEBUG_DRAFTS=1` to log why an AI draft was replaced by a template (word count, unsupported number or unsafe phrase). If the key or SDK is missing, typed sample commands and factual template notes remain usable and are labeled sample mode. No SDK is imitated. Live failures fall back to sample responses; availability alone is not proof of a successful API call.

The floating **Talk to GiftGuard** button starts a persistent live voice conversation. Click once, allow microphone access, and speak normally. OpenAI Realtime detects completed turns and streams its spoken response back. Continue speaking or interrupt the agent without uploading clips, reviewing transcripts, pressing Send, or reconnecting between turns. Mute controls the microphone; End conversation and closing the assistant disconnect and stop microphone/audio resources. The panel is a compact status bar; use the chevron to minimize it to the floating pill while the conversation continues, and click the pill to bring it back. Browser microphone permission and autoplay policies still apply; if playback is blocked, use Enable audio.

The browser establishes a WebRTC peer connection through an authenticated server SDP handshake at `/api/realtime`. Media then streams directly between browser and OpenAI, with a data channel for session events and tools. The full API key never goes to the browser. Configure `OPENAI_REALTIME_MODEL` (default `gpt-realtime-2.1-mini`) and `OPENAI_REALTIME_VOICE` (default `marin`). Voice transport does not require the optional Agents SDK: the Realtime model itself understands and responds to speech. The SDK still serves the typed/import/drafting agents when installed. See [OpenAI WebRTC documentation](https://developers.openai.com/api/docs/guides/voice-webrtc) and [automatic turn detection](https://developers.openai.com/api/docs/guides/realtime-vad).

Spoken requests are transcribed (`OPENAI_TRANSCRIBE_MODEL`, default `gpt-4o-mini-transcribe`) so they appear in the on-screen reply log; audio itself is not stored.

Four server tools provide bounded donor context (including a biggest-donors ranking by donations), open a workspace page on request (Start, duplicates, calls this week, all donors), draft notes, and create approval proposals. The drafting tool covers notes, emails, texts, letters and call scripts for one donor or for a described group; the voice agent is instructed to draft immediately when asked rather than asking what kind of message is wanted. Tool results carry minimal facts, while approval tokens stay in browser-only UI results. There is no tool that confirms, deletes, sends messages or runs arbitrary commands. An on-screen approval temporarily pauses the microphone while keeping the connection alive; spoken “yes” cannot commit changes. Donor history can remain open while the voice session continues. Audio is not recorded to files by GiftGuard. The UI identifies the voice as AI-generated and includes an optional model transcript.

The separate type button keeps the text assistant available. Its bounded recent history supports follow-ups, but it is not the live audio transport. The previous clip-upload and separate speech endpoints have been removed.

Restarting the server keeps staff signed in: the cookie secret is stored beside the database (or set `GIFTGUARD_SESSION_SECRET`). A live voice session started before a code change still uses the old tool list, so end it and reconnect after a restart.

For non-demo use, set `GIFTGUARD_DEMO=false`, configure a strong `GIFTGUARD_PASSWORD`, and select a separate `GIFTGUARD_DB`. Live mode does not seed or allow reset. This hackathon app has not been validated for deployment with real donor data.

## What works

- CSV/XLS/XLSX uploads, common header detection, short clarification questions for unfamiliar fields, and AI mapping suggestions when available.
- Original rows and gift history preserved; source labels and upload times shown.
- Exact file replay skipped, stable source transaction IDs checked, check numbers scoped to donor identity, and ambiguous/conflicting transactions retained with warnings.
- Conservative duplicate groups, evidence, confidence, preferred contacts, staff approval, rejection, skip, and merge undo.
- Monthly, quarterly and annual pattern detection using calendar dates and integer cents. Purchases do not establish donation cadence. Explicit recurring gifts take precedence over one-time extras.
- Follow-up drafts, English/Spanish variants, Give Miami Day notes, contact results, snooze and undo for reviews and contact edits. Outreach follows merged identities and is restored by undo.
- Typed requests use the same command handler as the sample mode. Example requests: “Who needs a call this week?”, “Show me Rosa Delgado”, “Approve all high-confidence matches”, “Who gave at the gala but hasn't given since?” Press Enter to send and Shift+Enter for a new line.
- Navigation and ranking by voice or typing: “Show me all donors”, “Open calls this week”, “Show me the donors to contact”, and “Who is our biggest donor?” (ranked by donations; purchases are excluded and the list is shown in rank order). Add “this year”, “last year” or a year to limit the ranking; “this year” is the workspace date’s year, which is the fixed 2026 demo date in sample mode.
- Drafting on request, by voice or by typing. Ask for a note, follow-up email, text message, letter, appeal or call script, for one donor (“Draft a follow-up email for Miguel Santos in Spanish”) or for a group (“Write a Give Miami Day appeal to everyone who came to the gala”). The draft appears in an editable box with a Copy button; for a donor on the call list it lands in that donor’s follow-up editor. Group drafts never name individuals. Nothing is sent.
- Synthetic seed: 300 people represented by 307 source identities, 899 transactions, nine late-gift suggestions and a three-record Rosa example. Four source files are in `public/demo/`.

## Demonstration

1. Open the sample workspace and show the weekly routine.
2. Review the Rosa group; approve combining, open her history, undo, and combine again. Gift count and total are unchanged.
3. Open this week's calls. Miguel's expected November 2 monthly gift is five days late; Elena's December 2025 gift is missing.
4. Draft/copy a note and record a call, then undo the update.
5. Click Talk to GiftGuard once, ask who needs a call, and continue the live conversation. Interrupt the agent with a follow-up. An approval request names the exact groups before anything changes. End conversation disconnects.
6. Reset the sample workspace from the workspace menu to repeat.

The sample starts populated so judges can immediately explore. Download and re-upload sample files to demonstrate replay protection; use a new transaction ID to demonstrate a new gift.

## Validation and limits

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

Tests cover API authentication/origin checks, exact-action approvals, stale/replayed confirmations, merge/undo preservation, import and Excel flows, conflict handling, date boundaries, one-time gift interference, command safety and outreach.

On November 7, 2026 the suite (141 tests), typecheck, lint and production build passed on the local machine. A browser walkthrough confirmed sign-in, the three-step Start page, Rosa’s merge and undo, the call list with Miguel (5 days) and Elena (311 days), and live AI drafting through the typed assistant for one donor and for a group. The WebRTC handshake to OpenAI Realtime reached the connected state from the browser through `/api/realtime` using a receive-only audio offer. A full spoken conversation with a microphone has still not been rehearsed; do that before presenting. See [the verification record](docs/VERIFICATION.md).

Other boundaries:

- A missing transaction does not prove a failed card. Exports must be current; newest gift date is not proof of complete coverage.
- There is no background polling, payment integration, outbound email/calling, check-photo capture, CSV export, multi-user accounts or hosted deployment.
- Deterministic matching is deliberately conservative; unfamiliar formats or irregular patterns need staff review.
- The ten-minute routine and low API-cost targets require real user timing and measured usage; they are not measured outcomes.
- No guarantee of hallucination-free prose: staff review AI drafts against displayed facts.
- SQLite is local, not browser localStorage. Selected fields leave the machine for live AI. API non-training defaults do not imply zero retention.
- The cached SheetJS version is suitable only for this trusted synthetic demo pending dependency/security review and upgrade before untrusted uploads. File size and row limits are not a full archive decompression defense.

See [product review and alternatives](docs/PRODUCT_DECISIONS.md) for the reasoning behind these decisions and official source links.

## Interface system

The interface uses manually installed shadcn/ui components backed by Radix, Tailwind CSS, and Lucide icons. `components.json` configures future shadcn additions. The palette is monochrome with restrained typography and spacing. Optional explanations are available through keyboard- and tap-accessible help tooltips; errors, import questions and exact approval details stay visible. The donor database is unchanged by the visual redesign.

## Demonstration differentiator

The live assistant brings up the relevant records, explains what it found, and creates a copyable draft while the conversation continues. A compact result card shows the last tool outcome. After staff confirm an action, the server's actual completion message is sent to the voice session for a spoken acknowledgement; a proposal alone never becomes a success claim. See [the demo story](docs/DEMO_STORY.md) for the Miguel/Spanish-note/Rosa-undo sequence.

## Watch the agent work

During a live voice session, **Show activity** enables a labeled GiftGuard pointer and a thin outline around the part of the workspace the agent is using. It follows real tool requests and returned results: finding records, opening follow-ups, preparing a note, and presenting a review card. Interrupting or ending the conversation clears it. It never clicks controls, changes keyboard focus, scrolls the page, or approves an action. Reduced-motion preferences use a static highlight. Optional activity can be hidden from the voice panel.

There are no simulated typing delays, guessed completion percentages or invented progress stages. A draft is marked ready only after a server result arrives, and a saved action is shown only after the actual confirmation response. Visual placement remains to be verified in the user's browser because automated browser access is unavailable in this session.

### Seeing what was uploaded

Open **Files & sources** on the Start page and click any uploaded source to see its rows as a table, exactly as they were in the spreadsheet (same column names, same values). You can search within the file and switch between uploads of the same source. The view is read-only and shows only rows that were imported; refunds and rows without an amount were never stored.
