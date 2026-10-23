# Rollcall

Rollcall is a college attendance project with a student-facing attendance dashboard, teacher class tools, QR-based check-in, and a separate mobile app backed by Supabase.

> **Prototype note:** The website is a browser demo. Its sample attendance and teacher workflows use browser-local data and do not sync with Supabase. The Supabase-backed service is used by the separate mobile app.

## Features

### Student website
- View overall and subject-wise attendance, classes attended, and classes missed.
- See alerts for subjects below the 75% attendance target.
- Get guidance on classes needed to recover to 75%, or how many classes can be missed while staying on target.
- View a sample weekly timetable.
- Check in by scanning a class QR code or entering the teacher’s current code manually.
- Submit a demo absence request with a class, subject, date, and reason.

### Teacher website
- Select a class by year, branch, and section, then choose a subject.
- Open or close a check-in session and display its QR code and live code.
- View and update a fictional sample student tracker.
- Review demo absence requests. Approving a request adds one demo attendance credit for the selected subject; duplicate credits are blocked.

### QR check-in
The website creates a QR code in the browser containing the selected class, subject, and current check-in code. The student’s browser camera can scan it and select the matching class details. A manual code entry option is also available.

The website demo rotates its code every 30 seconds. This can make old screenshots expire, but it **cannot prevent someone from sharing a live QR code**.

## Technology

- **Website:** HTML, CSS, and JavaScript
- **Mobile app:** Expo, React Native, and TypeScript
- **Backend for the mobile app:** Supabase Auth, PostgreSQL, Row Level Security (RLS), and an Edge Function
- **Website hosting:** Vercel

## Architecture

```text
Student/teacher website
  └── Hosted on Vercel
      └── Uses browser-local demo data; not connected to Supabase
