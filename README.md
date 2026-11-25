# LE Sales v2 — Lalit Enterprises sales force management

A mobile-first PWA for the salespeople, plus a responsive admin dashboard for the owner. There is no server to
run: the static site is on GitHub Pages and the data is in Firebase (Auth + Firestore).

- **Salesperson:** GPS check-in visits, quotations, follow-ups, orders, collections, customers, monthly target
  progress, and a WhatsApp daily report to +91 70042 21338.
- **Admin / manager:** KPI dashboard, charts, leaderboard, targets vs achievement, pipeline kanban, follow-up
  calendar, today's visits map, live activity feed, searchable records with CSV export, and team management.
- **Security:** role-based Firestore rules in `firestore.rules`. Only the admin can add employees.

Setup steps are in [SETUP.md](SETUP.md).

## Local development with the emulators

```
firebase emulators:start --only firestore,auth
```

Serve the folder and open `http://localhost:8765/?emu=1`. The app then uses the emulators instead of live Firebase.
