# Rollcall — Product requirements

## Product goal
Build a minimal, friendly college attendance app for students and teachers. Students can understand their attendance at a glance and mark class attendance; teachers can manage class attendance sessions.

## Users
- **Student:** checks attendance by subject, sees attended and missed classes, understands their percentage and how many consecutive classes they need to attend to reach 75%, and signs in/out of a class.
- **Teacher:** opens or closes a class attendance session and shares its QR/fallback attendance code.

## Functional requirements
1. Provide a clear student/teacher role switch.
2. Student overview shows total classes held, attended, missed, current percentage, and progress toward the 75% target.
3. Show the same attendance breakdown per subject.
4. Calculate the minimum consecutive classes to attend to reach 75%. If the student is already at or above 75%, show that they are on track.
   - The dashboard shows low-attendance alerts and, for each subject, the minimum classes to attend in the next four sessions to maintain 75%; below-target subjects show their consecutive-class recovery goal.
   - Include a clearly labeled sample weekly timetable and use Artificial Intelligence and Machine Learning in the sample subjects.
5. Let students select a subject and sign in with a QR scan or a manual fallback code. Keep sign-out available after sign-in.
6. QR scanning requests camera access only after the student chooses to scan. If scanning is unavailable or permission is denied, explain the issue and leave manual code entry available.
7. Teachers can select a class by year, branch, and section, then select a subject taught within that class. Show only the selected cohort/subject's live QR, attendance code, and attendance count.
   - Include a clearly labeled, interactive sample student tracker for the selected cohort and subject. It is a local demo roster, not real student data.
   - Scope browser-prototype sessions, rotating codes, QR payloads, and demo attendance independently to each cohort/subject pair; students select the same cohort/subject or have both selected by scanning the QR.
8. Live QR and manual codes rotate every 30 seconds. Expired codes are rejected, and each student can check in only once per class session.
9. Persist prototype attendance and session changes in the browser so a refresh does not erase them.
10. Make the interface responsive, keyboard-accessible, and usable without a camera.
11. Show a teacher-tracker verification column with neutral demo device signals and an in-person-check suggestion where appropriate. Clearly identify these as fictional prompts, not live device-risk detection or proof of proxy attendance.
12. Let a student submit an excused-absence demo request for a cohort, subject, class date, and reason, with a supporting-document file selection. Let the teacher approve or decline requests for the selected class. Only approval grants one attendance credit for the specified student/course/date; repeated requests must not award duplicate credit.

## Prototype boundaries
- Use sample student/course data and browser-local persistence; no real authentication, backend, or cross-device synchronization.
- A QR code scanned by the app must contain the same current, time-limited attendance code shown by the teacher. Manual code entry is the fallback.
- Rolling codes make old screenshots expire but cannot prevent someone from relaying a live code; this browser-only demo does not provide secure anti-proxy verification.
- Do not collect or transmit student data.
- The absence-request browser mock must not read, upload, or persist document bytes, filenames, or sensitive reason details. The student-selected file remains unavailable to the teacher; use fictional files only. Pending requests exist only in the current page session.
- Demo approval and verification prompts are not authoritative. A production workflow requires authenticated roles, private document storage, server-side decisions and attendance updates, audit history, and data-retention controls.

## Native Supabase attendance service
- The separate Supabase service uses Auth-backed student, teacher, and admin profiles, course enrollments, class sessions, attendance, and device approval records with Row Level Security.
- Teachers open sessions through an authenticated Edge Function. The function creates a server-side session secret and generates HMAC-SHA256 QR tokens in 5-second server-time slots; adjacent slots are accepted to allow network delay.
- Check-in is accepted only for an enrolled student with an approved device, a valid short-lived challenge signed by its P-256 key, a valid current/adjacent-slot QR token, and an open session. A database uniqueness constraint permits only one attendance record per student per session.
- Device enrollment is pending until faculty approval. Approval revokes the student's previous approved device. Repeated device changes are flagged for review.
- The cross-platform Expo app is in `mobile/`. It requests Android Keystore/Secure Enclave-backed P-256 keys and the web prototype does not call the Supabase service.
- The current Edge Function validates key possession but does not validate Android Key Attestation or Apple App Attest. Native key generation alone is not a server-enforced proof of hardware backing.
- The mobile client uses OTP sign-in, live QR scanning, teacher course/session management, faculty device approval, attendance totals, and 75% calculations. Browser-only manual codes/sign-out remain demo behavior and are not implemented in the native backend.
- Expiring QR codes reduce stale screenshot reuse but do not prevent a live code being relayed. Hardware-backed keys are platform-dependent and are not guaranteed on every device.

## Acceptance criteria
- A student can enter a teacher's active code, sign in, and sign out.
- Invalid and closed-session codes produce a clear error and do not change attendance.
- Teacher open/close changes are reflected in the student attendance flow.
- The overview and per-course metrics update after a successful sign-in.
- Attendance percent and the 75% consecutive-class calculation are correct at, above, and below the threshold.
- Low-attendance alerts, the next-four-class attendance plan, and the sample timetable update and render for every sample subject.
- The teacher can switch cohorts and subjects within each cohort, see only the selected QR/code, and update sample tracker attendance without affecting other cohort/subject counts. A scanned QR selects the matching cohort and subject.
- The teacher tracker labels illustrative device signals and suggested in-person checks as demo-only; no student is accused based on the sample signals.
- Students can submit an absence request against the correct cohort, subject, reason, and non-future date. The matching teacher queue can approve or decline it; approval affects attendance only once and only for that cohort/subject/date, while decline leaves attendance unchanged.
- Selecting a fictional supporting file does not transmit or persist file bytes, its filename, or medical details. The teacher UI explicitly says the file was not uploaded and cannot be reviewed in this mock.
