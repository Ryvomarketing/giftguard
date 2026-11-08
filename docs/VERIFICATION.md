# Verification record

## Passed in this environment

- `npm run typecheck`: passed.
- `npm run lint`: passed without warnings.
- `npm test`: 117 tests passed, 0 failed.
- `npm run build`: production build passed; all application/API routes compiled.
- Independent architecture and security review: identified issues were fixed with regression tests.

Covered: authentication and origin checks; one-use exact-action approval and stale/replayed confirmations; immutable gift totals through merge and undo; review/contact edit undo; merged outreach preservation; CSV/Excel replay and conflicts; check-number collisions; column/source clarification; explicit failed/refunded row exclusion; calendar and one-off gift boundaries; safe commands, gala filtering and grounded fallback notes.

The Node SQLite driver emits its documented experimental-feature runtime warning; this did not fail any checks.

## Blocked or unverified

- `npm start`: failed to bind `127.0.0.1:3000` with `EPERM` in the session sandbox.
- Registry and OpenAI API access: DNS `ENOTFOUND`.
- Real `@openai/agents` dependency is declared but absent locally; live SDK execution is unverified.
- API key is configured in an ignored local server file, but validity could not be checked.
- Browser rendering, responsive screenshots, keyboard/microphone interactions, live AI quality and latency are unverified.
- No hosted deployment or real-donor production validation.

Run on an unrestricted local machine, install the declared SDK, then validate desktop/mobile views and complete the demo script in README. Use only synthetic records until dependency/security and deployment hardening are complete. Do not present the offline command handler as a live model demonstration.

## Login regression fix

Reproduced a 403 when the browser used `http://127.0.0.1:3000`: NextRequest normalizes the request URL to `localhost`, but the browser Origin retains the IP. Login and authenticated mutation checks now share loopback-aware origin comparison. Four new tests cover IPv4/IPv6/hostname login, authenticated mutations, and rejection of unrelated origins, ports and schemes. All checks and the production build pass after the fix. Browser host was unavailable for interactive retesting.

## Monochrome redesign and speech

Replaced the persistent sidebar/assistant layout and decorative content with top navigation, focused task screens, shadcn/Radix controls, monochrome styling, Lucide icons and help tooltips. Source review confirms import questions, approvals, undo and donor history remain reachable.

Added checks for closed-by-default assistant markup, bounded conversation history and donor references, spoken agreement never authorizing mutations, and authenticated/bounded speech requests with binary audio and text fallback. Provider responses in speech tests are mocked: these tests do not establish live TTS availability or quality. Close/mute/playback and stale recording cleanup received independent code review, but physical browser/audio interaction remains unverified.

Browser-access host remains unavailable. Native Google Chrome control was denied by automatic approval review. No screenshots or visual pass score are claimed.

## Persistent live voice (current implementation)

The clip-transcription and separate speech endpoints were removed. The current voice path is an authenticated SDP handshake plus a persistent browser-to-OpenAI WebRTC connection, with semantic turn detection, streaming audio, interruptions, microphone mute, and explicit disconnect. Typed chat remains separate.

Current verification: 97 tests, TypeScript, ESLint and production build pass. Tests cover real protocol shapes with mocked peers/provider responses, microphone revocation, pending permission/SDP cancellation, stale response turns, duplicate call IDs, bounded tool dispatch, approval-token isolation, competing manual/voice approvals, selected-donor context, and server-confirmed outcome acknowledgements. No microphone recordings or separate transcription/speech API calls remain in the live client.

Independent review identified stale approval races, inaccessible End controls inside modal dialogs, hidden drafts, and stale screen context. These were corrected. Readouts remain bounded, and voice tools cannot confirm a mutation. Exact approval and all donor-history invariants remain covered by domain tests.

Actual browser-to-OpenAI connectivity, microphone/audio playback, model/key availability, and latency remain unverified in this restricted session. A mocked WebRTC test is not a successful live call. Rehearse docs/DEMO_STORY.md on the unrestricted machine before presenting.

## Visible agent activity

Current verification: 117 tests, TypeScript, ESLint and production build pass. Added tests for real tool start/result ordering, failure and interruption handling, blocked/stale proposals, receipt-only saved feedback, reconnect-safe activity identities, visible target clipping, modal scope placement and approval labels that cannot obscure the review card on small screens.

The visual pointer is passive: no clicks, focus changes, scrolling, simulated typing, progress percentages or artificial delays. It is optional and respects reduced-motion preferences. Browser screenshots and actual motion remain unverified because browser access is restricted. No visual pass score is claimed.

## Local run with the real SDK and a browser (November 7, 2026)

Run on the user’s machine with network access. The lockfile contained 89 version-less stub entries for optional platform binaries left by the restricted environment; they were removed and `@openai/agents@0.21.0` installed cleanly (12 advisories remain, all in the pinned SheetJS build, no fix available).

- `npm test`: 141 tests passed, 0 failed (four new general-draft tests).
- `npm run typecheck`, `npm run lint`, `npm run build`: passed.
- Real Agents SDK run with the configured key and `gpt-4.1-mini`: Note Writer produced AI drafts in all four formats for Miguel Santos and a group email for lapsed donors; the Command agent interpreted a casual thank-you text request and a group appeal request. The first Spanish email was rejected by the word-count validator at 69 words; the bounds were loosened to a safety net (note 45–110, email 55–170, text 15–75, call script 45–150) and all formats then passed.
- Browser walkthrough (Chrome DevTools, 1280×900): sign-in via sample workspace; Start page shows 4 sources, 899 transactions, 6 duplicate groups and 9 calls with badges; Rosa’s three records combine behind the exact confirmation card, counts drop to 5, the proof banner reports 3 transactions kept, and Undo restores 6 groups; the call list shows Miguel at 5 days late and Elena at 311 days; a typed Spanish follow-up email for Miguel landed in his follow-up editor labeled AI draft; a group Give Miami Day appeal and a group text message rendered in the assistant as editable drafts with Copy. Enter sends a typed message.
- Realtime transport: a receive-only audio offer posted to `/api/realtime` returned a valid SDP answer in about 7 seconds and the RTCPeerConnection reached `connected`. This proves the authenticated server handshake and the model/key for `gpt-realtime-2.1-mini`; it is not a microphone conversation.

Still unverified: a spoken two-way conversation with a real microphone and speaker, the activity pointer during live voice, mobile layout on a physical device, and the timed three-minute sequence.

## Voice navigation and biggest-donor fix (November 7, 2026)

User report: the voice agent could not answer “who is our biggest donor”, “show me all donors” opened Start, and “show me the donors to contact” / “calls this week” did not move the screen. Cause: no ranking view existed, and the only navigating tool fetched facts, so the model used the overview (which opens Start) or answered from an earlier result without a tool call. Added an `open_page` tool (start, duplicates, calls, donors) and a `top` view ranked by donations with purchases excluded; the donor list keeps the returned rank order. Typed equivalents (`top`, `donors` intents) were added for parity. 145 tests, typecheck, lint and build pass; the live Command agent was checked on the reported phrasings.

## Year filter for the biggest-donor ranking (November 7, 2026)

“This year”, “last year” and a named year now limit the ranking in both the voice tool (`year` argument) and the typed path (`year` intent field, resolved against the workspace date, which is passed to the Command agent and offline parser). The voice session instructions carry today’s workspace date so the model can resolve relative years. 146 tests, typecheck, lint and build pass; the live Command agent was checked on the three phrasings.

## Voice tool error after a server restart (November 7, 2026)

User report: asking the voice agent to open calls this week returned an error. The tool paths pass directly, and the production server does not log requests, so the cause was traced in code: the session cookie was signed with a random secret generated on every server start, and the server had been restarted three times for fixes while a voice session was open. Each restart invalidated the cookie, so tool calls returned 401 and the agent reported an error; a session connected before the restart also lacked the new `open_page` tool. Fixes: the signing secret now persists beside the database (`data/.session-secret`, owner-only) or comes from `GIFTGUARD_SESSION_SECRET`; a 401 during a voice tool call now tells the user their sign-in expired and to refresh, sign in and reconnect, tells the model the staff member is signed out, and returns the page to the sign-in screen (which ends live voice). Verified by signing in with curl, restarting the server, and confirming the same cookie still reaches `/api/state` and `/api/realtime/tool`. 149 tests, typecheck, lint and build pass.

## Compact voice panel (November 7, 2026)

User report: the voice panel covered part of the page. The panel was redesigned as a compact status bar (about 300px tall instead of up to 660px, 340px wide): status and hint on one line beside the microphone indicator, mute and end as icon buttons, drafts and the conversation log as collapsible sections, and a Minimize control that keeps the live conversation running while only the floating pill (status plus end) stays on screen. A group draft or any new draft reopens the panel so it is never hidden. Verified in a real Realtime session on the production build using a silent stand-in microphone track: connected, agent greeting played (status Speaking), minimized to the pill, and ended. 149 tests, typecheck, lint and build pass.

## Uploaded data table (2026-11-08)

Request: click an upload and see its data as a table.

- `GET /api/file` lists uploads (file, source, upload time, row count); `GET /api/file?name=` returns one upload's rows from the stored `raw_json`, newest gift first, capped at 500 rows for display with the true total alongside. Both require a sign-in and change nothing.
- Start page → Files & sources: each uploaded source is now a button ("View data · file.csv") that opens a dialog with a sticky-header, scrollable table of the original columns, a search box, a row counter, and a file picker when a source has more than one upload.
- Tests: `tests/uploaded-file.test.ts` (columns and order, missing cells filled, refunded rows absent, spreadsheet dates shown as days, 500-row cap, 401/200/404 on the route). Suite: 152 passing. Typecheck and lint clean (one pre-existing lint warning).
- Browser check on the production build at http://127.0.0.1:3000: opened Online donations → 244 rows, 13 original columns; searched "Carmen" → 4 of 244 rows; closed; all four source cards show "View data".
- Not covered: rows the importer skipped are not stored, so the table cannot show them; the import report's warnings remain the record of what was left out.

## Fresh-clone check (2026-11-08)

Copied the project without `node_modules`, `.next`, `data/` or `.env.local` into a scratch folder and ran it as a new user would.

- `npm ci` first failed with `EINTEGRITY` on `@types/papaparse@5.5.2`: the lockfile carried a checksum that did not match the registry. Replaced it with the registry's published integrity value (one line in `package-lock.json`). No other entry failed.
- After the fix: `npm ci` succeeds, `npm test` passes 152, `npm run build` compiles, `npm start` serves the app, the sample password signs in, the state route returns 307 donors and 899 gifts, and the new file view returns 244 rows. No environment file was present: demo mode, the sample password, the database and the session secret all came from defaults. Without an OpenAI key the app reports `aiAvailable: false` and uses sample mode, as designed.
- `npm audit` lists advisories in Next, sharp, postcss and minimatch. None are app code; they are dependency-tree notices that would be addressed by a future `next` upgrade.

## Landed-tab highlight (2026-11-08)

Request: when the assistant navigates, the top tab it opened should be visibly highlighted, not only underlined.

- `page.tsx` tracks `agentLanded` (the view the assistant just opened) for 3.6 seconds whenever navigation comes from the assistant, including ranked-donor results. Manual clicks clear it. The matching nav button and the page heading carry `data-agent-landed`.
- CSS: the tab fills as a black pill with white text and an inverted count badge for about 1.5 s, fades out, and the underline sweeps in from the left; the heading slides up. All of it is CSS keyframes and is disabled by the existing reduced-motion rule.
- Verified on the production build by sending "Show me the calls this week page", "Show me all donors" and "Open the duplicates page" through the typed assistant: the attribute appeared about 1.5 s after send (the command round trip) and computed styles read white text and a fully opaque pill at +450 ms. A frozen mid-animation frame was screenshotted for the visual check.
- Suite: 152 passing; typecheck and lint unchanged.

## Impact line, guided tour, giving timelines (2026-11-08)

Built from the three "wow" recommendations the user approved.

- `src/lib/showcase.ts`: `impactSummary` (open follow-ups' annual value, pending duplicate groups), `timelineMonths` (24 months, expected-but-missing month marked only when empty), `tourSteps` (five steps, English and Spanish, told with real numbers). Tests in `tests/showcase.test.ts`.
- `src/components/count-up.tsx`, `gift-timeline.tsx`, `tour.tsx`; `POST /api/speech` (OpenAI TTS, `gpt-4o-mini-tts`, voice from `OPENAI_REALTIME_VOICE`, 600-char cap, same-origin + sign-in + rate limit, nothing stored).
- Tour mechanics: script fixed in state when the tour starts (a first build recomputed it each render and restarted the tour every frame, which also flooded `/api/speech` and tripped the per-session limit, producing the browser fallback voice the user heard as "robotic"). Clips are now fetched one step ahead, with one retry, and the fallback is labelled in the caption. Manual navigation or Escape stops the tour; starting it ends a live voice session first.
- Verified on the production build: English tour visited Start → Duplicates → Calls → All donors → Start in ~60 s with the spotlight on the impact line, match records, follow-up detail, donor list and the voice launcher; Spanish tour starts with "Hola, soy GiftGuard…" and `/api/speech` returned 200 audio/mpeg for its clips. Impact line reads "$6,270 in regular giving at risk · 6 donors counted twice" on the sample data.
- Suite: 155 passing; typecheck and lint clean apart from the pre-existing warning.

## Quieter guidance text (2026-11-08)

User feedback on screenshots: helper sentences under the step headings looked like clutter, and the timeline caption needed to read as a note.

- Calls this week: the "check your latest files" sentence, the step-2 "use the note below…" sentence and the step-3 "choose an outcome…" sentence are now info tooltips (the existing HelpTip pattern) beside the toolbar and each step heading. The search box is an icon that expands into a 260px field on click, focuses, and collapses on Escape or blur when empty. Phone and email are now spaced and underlined as links.
- Duplicates: the reason line under "Are these the same person?" moved into the heading's tooltip as "Why these matched: …" together with the confidence caveat.
- Donor record: the timeline caption is a labelled Note block (left rule, muted background) and now says it reflects uploaded files.
- Verified in the browser on the production build; suite still passes.

## Answer bar and the "received" view (2026-11-08)

User report: asking the voice agent "who has paid their donations" gave a good spoken answer but the screen jumped to Calls this week, because every fact lookup opens a page and there was no view for recent gifts, so the model used the late list.

- `src/lib/answers.ts`: `receivedWindow` turns period words into a dated window (default the current month; last 30 days, this week, last month, this year, since the last upload); `receivedDonors` lists donors with donations in the window, newest gift first, purchases excluded; `receivedAnswer` gives the label, count and total.
- Voice tool: `get_donor_context` gains view `received` (period words in `query`), with instructions that "who has NOT paid" stays on `late`. Typed assistant: new `received` intent with a `period` field, offline phrases ("who has paid", "what came in since the last upload", "which donors have given in the last 30 days"); "not paid / haven't given" now routes to `late`.
- Every list answer (received, top donors, gala) carries `answer: { label, count, totalCents }`. The All donors page shows it as a black answer bar above the filtered list ("Gave in the last 30 days · 41 donors · $3,120 · Show everyone"); the spotlight lands on the bar, then the list.
- Tests: `tests/answers.test.ts` (window parsing, ordering and purchase exclusion, typed intents including "who has not paid" → late and "who has given the most" → top, voice tool output without contact details, activity targets). Suite: 159 passing.

## One search control everywhere (2026-11-08)

User request: every search area should be the magnifier icon that opens into a field, not a standing box.

- `src/components/search-reveal.tsx`: shared control (icon → 260px field with focus; Escape or clicking the icon clears and folds it; it also folds on blur when empty; a non-empty value keeps it open). Used on Calls this week, All donors and the uploaded-file table dialog; the one-off calls implementation was removed.
- Verified in the browser: collapsed width 2px, open width 260px, focus lands in the field, filtering works on each page (All donors "Rosa" → 3 donors; file table "Carmen" → 4 of 244 rows). Suite: 159 passing.

## Event sign-up lists (2026-11-08)

Request: event sign-up as original data capture, controllable from the voice agent with the same visuals ("I have a new gala coming up for the Miami Foundation on November 21, make me a sign-up list"), then shown with what a guest sees.

- `src/lib/events.ts`: `signup_events` and `signups` tables (created on demand, cleared by reset); `createEvent`/`deleteEvent` (only empty lists), `listEvents`, `publicEvent` (code, name, host, date only), `validateSignupInput`, `matchSignup` (email → phone → exact name(+ZIP) → last name+ZIP; prefers the duplicate whose name also matches), `addSignup` (cap 2,000 per event), `parseEventRequest`/`parseSpokenDate` (month-day, day-month, numeric, ISO; a date without a year is the next occurrence).
- Routes: `GET/POST/DELETE /api/events` (staff; `?qr=code` renders a PNG QR with the `qrcode` package, no external service); `POST /api/signup` (public, same-origin, per-address rate limit, returns only `{ ok, name, event }`); page `/signup/[code]` (server-rendered guest form, bilingual, noindex).
- UI: Events tab; `EventsPanel` with create form, event cards (guests, already-donors, pledged), detail with share link + Copy + Open, QR, guest table with match badges, two-step Remove for empty lists, and a phone-frame preview of the live guest form (`SignupForm preview`).
- Assistant: typed intent `event` (offline parser + Command agent fields `eventName`, `eventHost`, `eventDate`); voice tool `create_event`; `open_page` and `get_donor_context` know `events`; activity targets `nav-events` → `event-preview`/`event-detail`. Creation is direct (no approval card) because it adds an empty list only and is reversible; sign-ups are never deleted silently.
- Demo seed: "Fall Harvest Gala" (2026-10-20) with five guests, three matched to donors.
- Tests: `tests/events.test.ts` (date parsing, sentence parsing, create/match/validate/remove, demo seed, typed and voice creation, public route security, staff routes and QR). Suite: 164 passing; typecheck and lint clean.
- Browser check on the production build: typed "I have a new gala coming up for the Miami Foundation on November 21 can you make me a sign up list for that" → Events tab opened, "Miami Foundation Gala · Sat, Nov 21, 2026 · created by the assistant" selected, share link `/signup/c976ee7n`, QR rendered, phone preview showing the live guest form. Opened the guest page in a separate isolated browser context, signed up "Carmen Vega" with phone 202-555-0002, ZIP 33130, pledge $150 → "You're on the list"; the guest page never shows match data. The staff page then listed her with "Likely Carmen Vega · Same phone · High" and "$150 pledged".
- Two fixes found during that check: the staff guest table reused the guest form's `signup-row` class (renamed to `guest-row`), and the Events page did not refetch on a tab change; it now refreshes on open and every 8 s while visible, so a check-in table sees new guests arrive.

## Voice creation now gets the spotlight (2026-11-08)

User report: creating an event by voice highlighted the Events tab but the new list never got the agent's outline.

- Cause: the voice client publishes the "complete" activity as soon as the tool result arrives, but the event detail and guest preview render only after the page refetches its data (about 1.5 s). The spotlight started its fade timer at "complete", so it expired before the target existed; and when it did find the target, the detail sat below the fold, so only a sliver was outlined.
- Fixes: `AgentSpotlight` now starts the fade/hide timers only after a finished step's target has actually been found (the 8 s search window still bounds a missing target). `EventsPanel` scrolls the selected list into view (120 px scroll margin under the sticky header) whether it was opened by a click or by the assistant.
- Verified with a real Realtime session (silent stubbed microphone, request injected as a text item over the data channel): "I have a new holiday dinner coming up for the Children's Trust on December 12, can you make me a sign up list for that?" → the model called `create_event`, the Events tab lit up, "Children's Trust Holiday Dinner · Sat, Dec 12, 2026 · created by the assistant" opened, and the spotlight label "Your sign-up page is ready" pointed at the guest preview.

## Voice "best / biggest donor" showed nothing (2026-11-08)

User report: asking the voice agent for the best, biggest or top donor navigated to All donors with no donors shown.

- Reproduced in a live Realtime session with the request injected over the data channel. The model called `get_donor_context` with `view: "top"` but sent `query` as an object (`{"question": "Who is our best donor?"}`), which failed schema validation, so the call was rejected and nothing reached the screen. A second latent bug: the ranking views used `query` as a name filter, so even a string such as "best donor" would have filtered every donor out.
- Fixes in `src/lib/realtime.ts`: `query` and `year` are now preprocessed (string inside an object, array of strings, numeric text year are accepted; anything else becomes null); the tool description says query is a plain string or null; instructions list best/largest/most generous; rankings (top, gala) ignore the query unless it names someone in the donor list.
- Test added in `tests/voice-navigation.test.ts` for the wrapped query, text year, wrapped donor name, and the 200-character cap. Suite: 165 passing.
