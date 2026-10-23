# Rollcall — Design team prompt

Design a calm, cute, minimal attendance experience for a college community. The product has two roles: student and teacher. Keep the visual language warm and approachable without looking childish or sacrificing clarity.

## Visual direction
- Use a soft ivory background, deep ink text, leafy green as the primary action color, and a small apricot accent.
- Use rounded cards, generous whitespace, subtle borders, and light shadows. Avoid gradients, dense dashboards, and excessive decoration.
- Pair a friendly editorial heading style with a highly legible sans-serif for controls and data.
- Prefer a minimal system font stack: Inter, Aptos, then Segoe UI. Keep heading weights calm rather than extra-bold.
- Use small, simple line icons and clear labels; never rely on color alone to communicate status.

## Product surfaces
- Student dashboard: 75% target progress, attended/missed/held totals, subject breakdown, and a clear action to mark attendance.
- Student check-in: subject selection, QR camera scanner, manual fallback code, and an obvious signed-in/signed-out state.
- Teacher dashboard: attendance sessions by subject, open/closed status, shareable code, and attendance count.
- Teacher session cards show a Live Pulse QR and short code that refresh every 30 seconds, with a clear countdown.
- Role switching must be visible and consistent on desktop and mobile.

## Constraints
- Prioritize mobile layouts and accessible contrast, focus states, and touch targets.
- Reuse the same spacing, color, type, and component patterns throughout.
- Keep the teacher and student views visually related but make their primary actions unmistakable.
- Do not imply real authentication or live synchronization in this local prototype.
