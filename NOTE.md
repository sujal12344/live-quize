# IFM Developer Take-Home — Live Classroom Quiz
**Candidate Submission Note**

* **Live Production URL:** [https://live-quiz-server-ew7u.onrender.com/](https://live-quiz-server-ew7u.onrender.com/)
* **GitHub Repository:** [https://github.com/sujal12344/live-quize](https://github.com/sujal12344/live-quize)
* **Host / Projector View:** [https://live-quiz-server-ew7u.onrender.com/host](https://live-quiz-server-ew7u.onrender.com/host)
* **Student Mobile Join:** [https://live-quiz-server-ew7u.onrender.com/join](https://live-quiz-server-ew7u.onrender.com/join)
* **Teacher Visual Quiz Editor:** [https://live-quiz-server-ew7u.onrender.com/editor](https://live-quiz-server-ew7u.onrender.com/editor)

---

### 1. What Works
* **Rule 1 — Answers Stay on Server:** Question payloads sent to players and projector during active countdown never contain correct answers, answer indices, or explanations. Network inspection cannot reveal answers before the question closes.
* **Rule 2 — 10+ Players on Mobile Data:** Socket.IO over lightweight WebSocket/HTTP polling payloads (< 1 KB per question transition). Verified low memory footprint with non-blocking async persistence.
* **Rule 3 — Refresh Does Not Lose the Player:** Player nickname, room code, and secret cryptographic `playerToken` are stored in `localStorage`. Page refreshes or browser restarts automatically restore student name, cumulative score, and locked answer without creating duplicate participants.
* **Rule 4 — No Frozen Screens:** Real-time connection status monitoring. Interrupted networks surface explicit top banners with one-tap Retry buttons.
* **Rule 5 — No Secrets in Code:** Zero database credentials, API tokens, or secrets committed to git. All credentials managed exclusively via `.env` and platform environment variables (validated with git ignore checks).
* **Rule 6 — Scores Are Not Public:** Player scores are private to the individual student on their phone during questions. Room leaderboards are only broadcast through authenticated host sockets during reveal and podium phases; no public scrapeable endpoints exist.
* **Dual-Engine Persistence (Neon Cloud PostgreSQL + SQLite):** Live game rooms, questions, and player answer histories persist in Neon PostgreSQL (with zero-config SQLite fallback for local offline testing).
* **Presenter QR & PIN Join:** Projector displays high-contrast dynamic QR codes and 4-letter room codes for instant mobile camera joining.
* **Teacher Visual Quiz Editor:** Full visual question builder with custom points per question, time limits, single-click sample quiz loader, and JSON export.
* **Live Student Choice Feed & Option Switching:** Students can switch their chosen option before the countdown expires. The teacher's host screen displays a live real-time choice tally and activity stream.
* **Teacher Extra Time Controls:** Real-time `+15s` / `+30s` buttons on the host projector screen dynamically extend the question timer across all connected student devices simultaneously.
* **URL-Based Multi-Page Routing:** Clean routes for `/` (Home), `/host` (Projector view), `/join` (Student phone), and `/editor` (Quiz builder) with full browser Back/Forward history support.
* **Class Analytics & CSV Export:** Post-quiz performance analytics displaying class average %, per-question difficulty breakdown, and one-click CSV export of student results.

---

### 2. What Is Not Finished
* **Auditory Feedback & SFX:** Countdown ticking audio and celebration chimes for correct answers were omitted to preserve bandwidth on restrictive mobile data connections.
* **Custom Student Avatars:** Students currently pick nicknames; graphical SVG avatars / emoji pickers could be added.
* **Team / Group Battle Mode:** Currently runs as an individual student classroom competition; team-based scoring modes would be an exciting next feature.

---

### 3. AI Tools Used & Why
* **Antigravity (Google DeepMind):** Used as an interactive pair-programming assistant to scaffold the Express + Socket.IO server, implement server-authoritative timer logic in `quizStore.js`, draft dual-engine PostgreSQL/SQLite schema migrations, and polish the dark Obsidian visual design.
* **Why:** Accelerated boilerplate setup and test iteration, allowing focus on core game state machine invariants, zero-leak network security (Rule 1), and network resilience under simulated mobile dropouts.

---

### 4. What to Change With Another Week
* **Horizontal Scaling via Redis Pub/Sub:** Currently, Socket.IO runs in-memory with PostgreSQL writes. With another week, I would introduce `@socket.io/redis-adapter` backed by Upstash Redis. This would allow multiple server instances across different regions to share live room WebSocket events horizontally, supporting 10,000+ simultaneous concurrent classroom games.

