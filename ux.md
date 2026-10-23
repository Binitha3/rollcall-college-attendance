# Rollcall — UX team prompt

Map and refine the simplest useful attendance journey for students and teachers.

## Student journey
1. Land on an overview that immediately answers: “Am I on track for 75%?”
2. Review attended, missed, and held classes overall and by subject.
3. Choose a subject and scan the teacher's QR code or enter the displayed fallback code.
4. Receive clear success, invalid-code, closed-session, camera-denied, and unsupported-scanner feedback.
5. Sign out after signing in; keep the attendance record and show the session state.
6. Use the teacher's current Live Pulse QR or short code; expired codes should explain that the student needs the code currently shown in class.

## Teacher journey
1. Choose the teacher view.
2. Open or close a session for a subject.
3. Share the active code with the class and see the current attendance count.

## UX principles
- Make the manual fallback easy to find; camera access must be opt-in.
- Refresh Live Pulse codes every 30 seconds to make old screenshots stale without slowing down check-in. Explain that this discourages casual proxying but cannot stop someone sharing a live code.
- Explain the 75% calculation as consecutive classes to attend, not as an unexplained number.
- Prevent invalid or closed codes from changing attendance.
- Keep status, feedback, and recovery actions visible and understandable.
- Support keyboard operation, screen readers, mobile layouts, and users who deny camera access.
- For this prototype, clearly treat sample data and browser-local storage as local demo behavior.
