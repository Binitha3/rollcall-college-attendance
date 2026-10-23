# Rollcall — UI team prompt

Implement the Rollcall interface as a responsive, accessible web app using the project's existing patterns (or semantic HTML, CSS, and vanilla JavaScript when no app scaffold exists).

## Required interface
- Persistent Rollcall header and Student / Teacher role switch.
- Student overview with attendance percentage, a 75% target indicator, totals, subject cards, and navigation to attendance check-in.
- Check-in form with subject selection, camera scan action, manual code field, sign-in action, and sign-out action after a successful check-in.
- Teacher view with subject session cards, open/close controls, fallback codes, and attendance counts.
- Teacher session cards show a Live Pulse QR and manual code that update every 30 seconds with a countdown; copying should copy the current code.
- Clear inline feedback for success and errors; do not use alert-only feedback.

## Visual and interaction details
- Warm ivory, leafy green, deep ink, and restrained apricot accents; soft corners and simple surfaces.
- Strong focus indicators, labels for every form control, keyboard-friendly buttons, accessible status text, and mobile-friendly touch targets.
- Camera scanning should be opt-in and use browser QR detection when available; unsupported browsers and permission errors must retain usable manual entry.
- Reject expired Live Pulse codes with clear feedback. Do not describe rotating codes as complete anti-proxy security in this local demo.
- Use a minimal system font stack (Inter, Aptos, Segoe UI) consistently for headings, data, and controls.
- Preserve data in browser storage for this local prototype. Do not add a backend or external service.

## Delivery
- Keep the app easy to open and run locally.
- Verify role switching, code validation, sign-in/out, session state, and attendance calculations.
