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

1. Open the app and tap **First-time owner setup**. The email is fixed to `ankitcoolbindas@gmail.com`.
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
