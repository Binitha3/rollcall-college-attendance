# Rollcall — Development notes

Rollcall currently contains a browser-only attendance prototype with student and teacher views. That prototype still uses seeded sample data and `localStorage`. A Supabase-backed native attendance service is defined separately for authenticated users and device-bound check-in.

## Prototype behavior
- Student and teacher flows in the current web page use browser-local persistence and seeded sample data.
- The teacher demo first selects a class cohort by year, branch, and section, then a subject within that cohort. It shows that cohort/subject's rotating QR/code and an explicitly fictional local sample roster. Demo check-ins are stored per cohort and subject in that browser and reset when that session is reopened; they are not real student records and do not sync between devices.
- Its sample fallback codes rotate every 30 seconds and are not secure anti-proxy verification.
- Teacher sessions are scoped to a cohort/subject pair. QR codes encode the cohort, subject, and current short code. Student check-in lets students select their year, branch, section, and subject; scanning selects the matching choices before checking in. The browser demo still stores session state locally per browser.
- QR scanning uses browser detection when available and requests camera permission only after the student chooses to scan.
- The prototype is not authenticated and does not read or write the Supabase service described below.
- The student absence-request form and teacher queue are an in-memory simulation for the same browser session. The selected PDF/image is never read or uploaded; only its local selection is acknowledged, and its name/bytes are not persisted or shown to the teacher. Use fictional sample documents only, never real medical certificates or other sensitive files.
- Teachers see fictional device-sign-in signals and an in-person-check suggestion in the demo tracker. These are hard-coded examples, not device telemetry or evidence of proxy attendance.
- A teacher's demo approval credits the selected student/course's attendance once for the requested date. The pending request and its reason disappear on refresh; only the minimal demo attendance totals and duplicate-prevention key are persisted locally. Declines do not change attendance. This is not certificate verification or a real approval system.
- A production absence workflow needs authenticated student/teacher authorization, private document storage, server-side review and attendance updates, audit history, and data-retention rules. Never treat the browser-only mock as secure or authoritative.

## Completion checklist
- Student and teacher flows are usable from the interface.
- Attendance calculations are correct and update after successful check-in.
- Invalid inputs and unsupported/denied camera access are surfaced without silently failing.
- Existing behavior is preserved and relevant documentation is updated.
- Run the smallest applicable validation command and report the result.

## Running the prototype
From the project folder, run `python -m http.server 8000` and open `http://localhost:8000`. Camera scanning requires a secure browser context such as localhost or HTTPS; manual fallback codes remain available when camera scanning is unsupported.

## Supabase mobile app
- The Expo React Native client is in `mobile/`. Copy `mobile/.env.example` to `mobile/.env`, then run `npm install` and `npx expo start` from that folder. The publishable key is intended for client use; never put a Supabase service-role key in the app.
- Because the client uses a custom native device-key module, Expo Go is not sufficient. Generate/build a development client with `npx expo prebuild` and `npx expo run:android`. iOS native builds require macOS/Xcode or an authorized remote EAS build.
- Android uses Android Keystore and refuses keys not reported hardware-backed. iOS creates P-256 private keys in Secure Enclave; devices without it cannot enroll.
- The custom module signs the server challenge and returns only its public key/signature. Supabase Auth uses one-time email codes; configure the Supabase email template to provide a code that works with `verifyOtp`.

## Supabase backend
- The deployed migrations are mirrored in `supabase/migrations/20261023060056_rollcall_attendance.sql` and `supabase/migrations/20261023060432_lock_down_helpers.sql`. The deployed Edge Function is `supabase/functions/rollcall/index.ts`, named `rollcall`, with JWT verification enabled.
- The function expects Supabase's `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` environment variables. The service-role key must remain server-side.
- New Auth users receive a `student` profile. An administrator must promote faculty accounts by updating `profiles.role` to `teacher` in the Supabase SQL editor. Teachers create courses and enroll students using the Edge Function.
- Teachers enroll students by their Supabase Auth user ID. Enrollment and device approval are required before check-in.
- The available Edge Function actions are `create-course`, `enroll-student`, `start-session`, `close-session`, `get-token`, `enroll-device`, `approve-device`, `issue-challenge`, and `check-in`.
- Dynamic QR tokens use server-time 5-second slots with a one-slot grace window. QR payload is JSON: `{ "v": 1, "session_id": "...", "slot": 123, "token": "..." }`. Every student can check in only once per class session (stricter than one use per token).
- On enrollment the native app submits a P-256 public JWK after OTP sign-in. Faculty approve the pending device for an enrolled student; approval revokes any prior approved device. On each check-in, the app obtains a fresh challenge, signs `rollcall-v1\n{challenge}\n{session_id}\n{slot}\n{token}` with the device key using SHA-256, converts the native DER signature to IEEE-P1363, and submits it as base64url.
- The server validates the QR HMAC, time window, open session, enrollment, OTP-authenticated device enrollment, one-time challenge, signature, approved device, and unique attendance record. It does not trust the device clock.
- Do not describe a rotating QR as eliminating live relays. Hardware backing depends on the native platform and device; the browser prototype cannot provide it. Device-change events are retained and repeated enrollment is flagged for review, not automatically blocked.
- The native module requests hardware-backed keys, but the service currently verifies key possession only. Android Key Attestation and Apple App Attest are not verified server-side, so a modified client could submit a software-generated key; add platform attestation verification before treating hardware status as a server-enforced security guarantee.
- The current browser prototype remains local-only and does not use Supabase. The mobile client requires account roles, course records, enrollments, and faculty device approval before production check-ins can succeed.
- To grant a user teacher access, create their Auth account first, then run `update public.profiles set role = 'teacher' where id = '<auth-user-uuid>';` in the Supabase SQL editor. Configure the Supabase email template to send the numeric `{{ .Token }}` so the OTP screen can verify it.
- `npm audit` currently reports 15 high-severity findings in the Expo/Metro dependency tree. Its automatic remediation would downgrade Expo to 44 and React Native to 0.72, so that breaking downgrade was not applied; recheck for compatible upstream patches before release.
