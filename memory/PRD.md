# VoteSecure — PRD

## Original problem statement
"Build a landing page: VOTESECURE — COMPLETE MASTER DEVELOPMENT PROMPT — Secure Online College Election Management System. Developer: Hriata_khuptong. Initial Administrator Email: hriatakhuptong1@gmail.com ..." (full specification: student registration verified against an authorised registry, election lifecycle Draft→Scheduled→Open→Closed→Finalized, candidates, eligibility engine, one-ballot-per-student secure voting with privacy separation, layered security, tamper-evident audit, reconciliation/finalization, analytics, admin/auditor/operator dashboards, no Google/social login, no demo/fake data, credit "Built and developed by Hriata_khuptong", automated tests, documentation).
Follow-up (UI): "Implement the VoteSecure UI using the supplied visual design reference. Primary navy #0A1F44, Secondary blue #0EA5E9, Cyan accent #22D3EE, Success #10B981, Warning #F59E0B, Error #EF4444, Background #F8FAFC, Card #FFFFFF, Inter, rounded cards, subtle shadows… Treat the reference strictly as a visual guide… All data from the real backend."

## User choices
- Full working app (not landing page only)
- React + FastAPI + MongoDB (instead of Node/Postgres) — accepted trade-off
- INITIAL_ADMIN_PASSWORD secret, forced change at first login
- No email: admins verify manually and issue reset tokens

## Architecture
- Backend `/app/backend`: core.py (env, db, audit hash chain + HMAC checkpoints, rate limits, pagination), auth.py (Argon2id, server sessions, CSRF, lockout, TOTP MFA, admin provisioning), students.py (registration, verification, registry CSV import/export), elections.py (elections, lifecycle, readiness, candidates, eligibility, two-person approvals, auto-close job), voting.py (ballots, participation, receipts, tally, reconciliation, finalize, publish, results), monitor.py (analytics, audit viewer/verify, findings, staff accounts, reset tokens, ops status), server.py (middleware, error format, security headers, request metrics). API prefix /api/v1.
- Frontend `/app/frontend/src`: light navy/blue design system (components/vs/*), pages for public, student, admin, auditor, operator.
- Docs: /app/README.md (deployment), /app/docs/PROJECT_REPORT.md (25-section academic report). Tests: /app/backend/tests/test_votesecure.py.

## Personas
Student voter, Election administrator, Election auditor, System operator.

## Implemented (2026-10-09)
- Complete backend + frontend for all roles; 31/31 pytest passing (separate test DB); E2E passed (iteration_1)
- Light re-skin per supplied reference (iteration_2 visual regression passed; student vote flow re-verified by screenshot)
- Preview DB wiped after testing; only the initial admin is re-provisioned

## Implemented (2026-06 — fork)
- Candidate photo uploads via Emergent Object Storage: admin upload/replace/remove on election Candidates tab, display on student ballot cards (fallback to initials). Backend photos.py + storage.py; magic-byte sniff + Pillow verify() hardening; student can only fetch photos for elections in visible states.
- E2E verified (iteration_3): 32/32 pytest + 4/4 live-URL tests (upload→GET bytes, replace, remove, draft-student-denied, full flow nominate→approve→eligibility→schedule→open→vote→duplicate 409→close→reconcile→finalize→publish). UI smoke pass.
- Mobile fix: Home hero (ICFAI University photo) object-position now responsive (object-center on mobile, object-right on sm+) so the building is no longer cropped on phones. Desktop look unchanged.
- Preview DB cleaned of automated-test artifacts (Live Photo Test elections, LIVE-*/CHK-* students); owner data retained.

## Implemented (2026-06 — fork, round 2)
- Signed reconciliation & results reports: downloadable PDF (reportlab) + results CSV from the admin Results tab; each document carries a SHA-256 fingerprint + HMAC-SHA256 signature (server checkpoint key) with honest, non-overclaiming wording. New `reports.py`; POST `/reports/verify`. (backend pytest-verified)
- Candidate photo upload hardened with Pillow `Image.verify()` (rejects corrupt/garbage-after-magic images).
- Privacy "Read the details" + all route changes now scroll to top (App.js `ScrollToTop`), with sticky-nav-aware hash handling.
- Student name validation: Unicode letters + spaces + apostrophes + hyphens allowed; digits/emoji/symbols rejected; trimmed; enforced FE (zod) + BE (`core.valid_name`) across registration and registry CSV import.
- Semester restricted to 1–6 everywhere: register dropdown, backend RegisterIn, registry CSV import, and election eligibility `semesters`.
- Mobile Login fix: public nav CTA links now close the Radix Sheet (setOpen(false)) so the login form is immediately interactive — no more "press Back" workaround.
- Hero image: responsive object-position (object-center mobile / object-right desktop) + lighter mobile overlay so the ICFAI building stays visible and uncropped.
- NEW admin-only Security Command Center (`/app/admin/security`, monitor.py `GET /admin/security`): real failed-login / rate-limit / unauthorized / suspicious counts (24h & 7d), audit-chain integrity, locked accounts, reconciliation discrepancies, system health, and a 7-day events table with hashed sources + deterministic recommended actions. No fabricated alerts; no passwords/tokens/ballot choices exposed.
- Already-present (verified, not rebuilt): election readiness checklist with real blocking reasons; reconcile→finalize→publish integrity workflow with two-person approval and immutable results.
- Tests: 36/36 backend pytest (added name validation, semester 1–6 register+CSV, `/admin/security` RBAC+shape, signed report download+verify). Frontend UX verified (iteration_4): privacy nav, mobile login, name/semester validation, Security Center real data, hero regression.

## Implemented (2026-06 — fork, round 3)
- Candidate photo crop step: new `PhotoCropDialog` (Radix Dialog + shadcn Slider + canvas, no new dependency) — on upload the admin drags to position and zooms, with a circular preview matching the ballot avatar; output is a centered 512×512 JPEG sent to the existing `/candidates/{cid}/photo` endpoint (accepts up to 8 MB source, outputs <1 MB). Verified end-to-end in-browser (seed data cleaned afterward).
- Turnout donut on the admin overview (`AdminOverview.jsx` `TurnoutDonut`, recharts PieChart) showing aggregate % voted across active elections with the figure in the centre. Verified (iteration_5).
- Full election cycle demo: `backend/seed_sample_election.py` created one real FINALIZED (not published, so admin-only) election "ICFAI Student Council 2026" (3 eligible, 2 voted) so the signed PDF/CSV report buttons are live and downloadable in the UI. Delete anytime with `python seed_sample_election.py --delete`. Report downloads verified in-browser (iteration_5).

## Backlog
- P1: Email verification / email reset (needs email provider)
- P1: Candidate photos (needs object storage)
- P2: MongoDB replica set for true multi-document vote transactions in production
- P2: Downloadable reconciliation report (PDF), donut turnout chart on admin overview
