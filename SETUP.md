# LE Sales v2 — setup (sales force management)

- **App (everyone):** https://ankitcoolbindas-art.github.io/le-sales-app/
- **Owner dashboard:** the same link. The admin lands on the dashboard; `owner.html` redirects there too.
- **Firebase project:** `le-sales-app`, with Email/Password sign-in, Firestore in asia-south1, on the free Spark plan.

## 1. Publish the security rules (required, one time)

v2 can't read or write any data until these rules are live.

1. Open https://console.firebase.google.com/project/le-sales-app/firestore/rules
2. Delete what's there and paste everything from [`firestore.rules`](firestore.rules).
3. Click **Publish**.

## 2. Create the one database index (recommended, one time)

1. Open https://console.firebase.google.com/project/le-sales-app/firestore/indexes and choose **Create index**.
2. Fill it in:
   - Collection ID: `records`
   - Fields: `ownerUid` **Ascending**, then `date` **Descending**
   - Query scope: Collection
3. Click **Create**. It takes a few minutes to build.

Without this index the salesperson app still works. It uses a slower fallback query that reads up to 3,000 of
that person's records.

## 3. Owner first login (Ankit, one time)

1. Open the hidden owner-setup page: https://ankitcoolbindas-art.github.io/le-sales-app/#/owner-setup (it is not linked from the login screen). The email is fixed to `ankitcoolbindas@gmail.com`.
2. Choose your own password (at least 8 characters) and tap **Create owner account**.
3. Firebase emails a verification link to ankitcoolbindas@gmail.com. Open it (check spam).
4. Back in the app, check your name and phone, then tap **I've verified — continue**. You are now the **Admin**.
   - The rules only allow this exact, verified email to become the first admin. Nobody else can.
   - If the screen says the account already exists, tap **Forgot password?** on the sign-in screen, set a new
     password from the email link, then sign in.

## 4. Add employees (admin only)

1. Go to **Team & targets → Employees → Add employee**.
2. Enter their name, email, phone, territory and role (Salesperson or Manager). A temporary password is suggested.
3. Tap **Create login**. Then use **Copy** or **Share on WhatsApp** to send the login details to the employee.
4. The employee signs in and must set their own password straight away.

Other employee actions:

- **Reset password** emails the employee a reset link.
- **Deactivate** blocks them immediately, even on a phone that is already signed in. Their history is kept.
- Set **Targets** per employee per month: sales ₹, collection ₹ and visits. Progress shows on the leaderboard
  and on each salesperson's Today screen.

## 5. Live location tracking

**Re-publish the rules after this update.** `firestore.rules` now has a `locations` / `lastLocation` section. Paste the whole file into Firebase console → Firestore → Rules → Publish. Until you do that, location writes are denied, and the Live map stays empty. Nothing else breaks. No new index is needed, because the route query uses only equality filters.

- **When it records:** while a salesperson is signed in and the app is open. It writes a point every ~2 min, on movement of 150 m or more (at most one every 20 s), and at each customer check-in.
- **What the salesperson sees:** the top bar shows "Location on / Locating… / Location off", and so does the Today card. The first time they sign in, a one-time notice explains the sharing. Tapping the pill shows the details and a Restart button.
- **Owner/manager Map & live screen:**
  - **Live:** each salesperson's current position, with an accuracy circle and the last-seen time. Green = seen under 5 min ago, amber = under 30 min, grey = older. Battery is shown where the browser reports it.
  - **Route:** pick a person and a date. You see their tracked path as a dotted line, start/end markers, numbered customer check-ins, and the km travelled.
  - **Visits:** check-in pins.
- **Access rules:** salespeople can write only their own location and read only their own. Admin and managers read everyone's. Location points can't be edited or deleted. Only `lastLocation/{uid}` is overwritten with each new point.
- **Web limitation:** browsers pause GPS when the app is closed, the phone is locked, or the tab is in the background. For all-day background tracking, use the Android app. Both write the same documents.

### Location document (shared by web and the coming Android/Capacitor app)
`locations/{uid}_{ts base36}`, which is append-only, and `lastLocation/{uid}`, which holds the latest point. The fields are:

| field | type | notes |
|---|---|---|
| ownerUid | string | must equal the signed-in user's uid (required) |
| ownerName | string | display name |
| lat, lng | number | required, range-checked |
| accuracy | number | metres (required) |
| ts | number | ms since epoch, GPS fix time (required) |
| date | string | `YYYY-MM-DD` local date, used by route replay (required) |
| source | string | `'web'` or `'android'` (required) |
| reason | string | `start` / `interval` / `move` / `checkin` (Android may add `background`) |
| battery, charging | number 0–1, bool | optional |
| speed, heading | number | optional (m/s, degrees) |
| deviceId, appVersion | string | optional |
| updatedAt | number | optional |

The rules reject any other field. The Android app should sign in with the same Firebase Email/Password account and write the same shape with `source:'android'`. It can batch points it saved while offline, because each point has its own id.

## Roles

| Role | Can do |
|---|---|
| Salesperson | Log their own visits (GPS check-in), quotations, orders and collections. See their own customers, follow-ups and targets. Send the WhatsApp daily report. Cannot see other people's data. |
| Manager | Everything above, plus read-only access to all dashboards, records, team and targets. Cannot add employees or set targets. |
| Admin (owner) | Everything, including adding or deactivating employees, setting targets, and moving anyone's quotation in the pipeline. |

No account can hard-delete records. Delete only hides an entry.

## Notes and limits

- Free Spark plan: 50k document reads and 20k writes per day.
  - Opening the admin dashboard reads about as many documents as there are records in the last 60 days.
    For example, 10 salespeople × 15 entries a day × 60 days ≈ 9,000 reads. Reopening within about 30 minutes
    reads only what changed.
  - A salesperson's phone reads only their own records.
  - For a large team, move to the Blaze pay-as-you-go plan (cents per 100k reads), or lower `MGR_DAYS` in
    `js/core.js`.
- Phones work offline. Entries are queued and sync automatically when back online.
- On a shared computer, sign out after use. Data cached for offline use stays in that browser.

## Recovery: owner setup page (hidden)
The login screen no longer shows "First-time owner setup" (the admin account is already claimed).
If the owner account ever has to be recreated (e.g. a new Firebase project), open
`https://ankitcoolbindas-art.github.io/le-sales-app/#/owner-setup`. It only works for `ankitcoolbindas@gmail.com`
after email verification, and Firestore rules still decide who can become admin. If the account already exists,
use **Forgot password?** on the normal sign-in screen instead.

## v3 — Attendance & Payroll

**Publish the new `firestore.rules` before anyone uses Attendance on the live site** (Firebase console → Firestore → Rules → paste the whole file → Publish). Until then check-in, leave and payroll writes are refused (the old rules close every unknown collection).

No new indexes are needed: all new queries are equality-only or single-field (`attendance` by `date` / `month` / `uid`+`month`, `leaves` by `uid` / `status` / `to`, `payroll` by `month` / `uid`+`status`).

New collections:
- `attendance/{uid}_{YYYY-MM-DD}` — one doc per person-day. Employee creates it at check-in (today in IST by server clock, once) and updates it once at check-out. Admin corrections only touch `ovStatus/ovReason/ovBy/ovByName/ovAt/ovFrom`; captured times, GPS and photos stay as evidence.
- `attendancePhotos/{uid}_{date}_{in|out}` — the selfie as a ~10–40 KB JPEG data URL (Spark plan has no Cloud Storage). Write-once; must be written in the same batch as the check-in/out.
- `leaves/{id}` — employee requests, admin approves (paid/unpaid) / rejects / cancels.
- `settings/attendance` — office start, grace, half-day hours, weekly off, holidays, pay basis, late rule.
- `salary/{uid}` — admin only (managers and employees can't read).
- `payroll/{uid}_{YYYY-MM}` — admin only; `finalized` docs are locked and readable by that employee only.

Day rules: check-out with < half-day hours, or no check-out, = half-day. Late = check-in after start + grace. Days before the joining date are unpaid.
Pay: calendar basis (default) = salary ÷ days in month × (present + ½ half-days + paid leave + week-offs + holidays); working basis = salary ÷ working days × (present + ½ half-days + paid leave on working days). Optional: every N late marks = ½ day cut.

Tests: `tests/rules-v3.test.mjs` (77 rule checks) and `tests/e2e-v3-emulator.mjs` (mock data, screenshots `screens/v3-*.png`). Run from `/workspace/le-sales-tools` with the emulators started (`firebase emulators:start --only firestore,auth`).
