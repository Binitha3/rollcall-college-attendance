# Rollcall — Testing team prompt

Validate the student/teacher attendance prototype against these behaviors. Report reproducible steps, expected vs. actual results, and severity for any failures.

## Functional coverage
- Switch between student and teacher views.
- Open and close attendance sessions; verify live codes are accepted only while open and refresh every 30 seconds.
- Verify a previous rolling code is rejected after its 30-second window and a newly displayed code succeeds.
- Enter a valid code, sign in, and sign out. Confirm totals and subject attendance update only once.
- Try a wrong code, a code for another subject, and a closed-session code; confirm attendance remains unchanged and clear feedback is shown.
- Scan class QR codes for different year/branch/section and subject combinations on a supported browser; confirm each selects the matching cohort and subject and checks in with its active code. Test unsupported `BarcodeDetector`, camera denial, and manual fallback.
- Refresh the page and confirm locally persisted attendance/session state remains intact.

## Attendance calculations
- Verify attended, missed, and held totals and percentages.
- Check below, exactly at, and above 75%.
- For below-target attendance, verify the smallest consecutive-attendance count `n` satisfying `(attended + n) / (held + n) >= 0.75`; show zero needed when already on target.
- Confirm the dashboard attendance plan reports consecutive classes needed to recover below-target subjects and allowable absences for subjects currently at or above 75%.
- Confirm the alert count and low-attendance notices update when attendance changes, and the sample timetable includes all current subjects.
- In both student and teacher views, select different year/branch/section cohorts and subjects available within them. Confirm each QR, code, open/closed status, and check-in belong only to the selected cohort/subject; closing one section's session must not close the same subject in a different section.
- Confirm the selected teacher QR renders at a large, crisp size with a readable live code on presentation-size and narrow screens.
- Use the teacher demo tracker to check in sample students, change cohorts and subjects, and verify present counts persist only for that cohort/subject. Confirm the roster is labeled sample/demo data and check-in controls are disabled for closed sessions.
- Confirm sign-in/out does not inflate class totals on repeated clicks.
- Confirm each QR encodes the same cohort, subject, and current code shown to the teacher, and the one-check-in-per-cohort/subject session rule survives code rotation.
- Check the tracker review column for multiple fictional device/repeated-sign-in signals, and verify these are clearly labeled as demo-only suggestions, not detected misconduct.
- Submit an absence request with a fictional PDF/image, selecting cohort, subject, past/today date, and reason. Confirm the request appears only in that selected class's teacher queue and shows that the file was not uploaded or shared.
- Approve a request and confirm the selected course's attended total increases once, the requested date is associated with the approval, a duplicate request/approval does not add another credit, and other subjects/cohorts remain unchanged. Decline a separate request and confirm attendance does not change.
- Verify future dates, unsupported file types, and files over 10 MB are rejected. Confirm no file bytes/name, reason, or pending request is written to `localStorage`; refresh and verify pending requests are cleared while the minimal approved attendance state remains.

## Quality and accessibility
- Test keyboard-only navigation, visible focus, form labels, status announcements, and readable contrast.
- Inspect narrow mobile, tablet, and desktop layouts.
- Confirm camera access is never requested before the user activates scanning and manual entry remains available after camera errors.

## Supabase/native backend checks
- Confirm RLS prevents anonymous access and prevents authenticated users from reading session secrets or challenges.
- Confirm a student cannot start/close a teacher session, enroll another user, approve a device, or check in without enrollment.
- Confirm teacher sessions are restricted to the teacher assigned to that course, and only one session per course can be open.
- Confirm QR HMAC tokens generated in the current 5-second server slot are accepted, stale/future slots outside the ±1-slot window are rejected, and a closed session rejects check-in.
- Confirm a valid P-256 device signature and one-time challenge are required; expired/reused challenges and revoked devices are rejected.
- Confirm concurrent requests cannot create duplicate attendance for a student/session and a closed session cannot accept a racing check-in.
- Confirm approving a replacement device revokes the old approved device and creates device-change events; repeated enrollment sets the risk flag.
- Verify platform attestation before representing a key as hardware-backed. Android Key Attestation and Apple App Attest verification are not implemented by the current service.
- The browser prototype does not exercise the Supabase backend checks. The native client is in `mobile/`; use an Android hardware-backed device or iOS Secure Enclave device after provisioning accounts, roles, courses, and enrollments.
- Run `npm run typecheck` in `mobile/` and build a native development client. Expo Go cannot load the custom signing module. iOS compilation requires macOS/Xcode or a remote EAS build.
- Recheck `npm audit` before release. It currently reports 15 high-severity Expo/Metro dependency findings; the suggested automatic fix downgrades Expo and React Native across major versions.
