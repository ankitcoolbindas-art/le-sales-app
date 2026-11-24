# LE Sales — setup

**Salesperson app:** https://ankitcoolbindas-art.github.io/le-sales-app/
**Owner panel:** https://ankitcoolbindas-art.github.io/le-sales-app/owner.html

The app works straight away in **local-only mode**. Entries are saved on each phone, and the salesperson sends the
daily report to the owner on WhatsApp (+91 70042 21338). Live updates on the owner panel need the one-time Firebase
setup below. It's free on the Spark plan and takes about 10 minutes.

## A. Firebase setup (Ankit does this once)

1. Open https://console.firebase.google.com and sign in with your Google account.
2. Click **Create a project** (or **Add project**). Name it `le-sales`. You can switch Google Analytics off. Click **Create**.
3. **Turn on Anonymous sign-in:** go to **Build → Authentication → Get started → Sign-in method → Anonymous → Enable → Save**.
4. **Create the database:** go to **Build → Firestore Database → Create database**.
   - Location: **asia-south1 (Mumbai)**. You can't change this later.
   - Choose **Start in production mode** and click **Create**.
5. **Paste the security rules:** in Firestore, open the **Rules** tab. Delete what's there, paste everything from
   [`firestore.rules`](firestore.rules) in this repo, and click **Publish**.
6. **Register the web app:** go to **Project settings (gear icon) → General → Your apps → Web (`</>`)**.
   - Nickname: `LE Sales`. Leave Hosting unticked. Click **Register app**.
   - Firebase then shows a `firebaseConfig = { apiKey: …, authDomain: …, projectId: …, … }` block. Copy it.
7. (Recommended) Go to **Authentication → Settings → Authorized domains** and add `ankitcoolbindas-art.github.io`.
8. Send that `firebaseConfig` block to your assistant, who pastes it into `firebase-config.js` and publishes it.
   This config is meant to be public and isn't a password.
9. **Pick a private Team code** of at least 8 characters, for example `LE-Ranchi-7Xq29k`. Keep it out of any public
   place. It's the key to your sales data.

## B. On each salesperson's phone

1. Open the app link in Chrome. From the menu, choose **Add to Home screen / Install app**.
2. Enter the salesperson's **name** and an optional 4-digit **PIN**, then the **Team code** from step A9. Tap **Save**.
3. Allow **Location** when asked. Each visit records GPS position, accuracy and time.
4. The header shows **Live · synced**. With no internet, entries are queued ("Offline · N queued") and sent
   automatically when the phone is back online.

## C. Owner panel (Ankit)

1. Open the owner panel link on your phone or computer.
2. The first time, choose an **owner PIN** for that device and enter the same **Team code**.
3. The panel then shows a live feed, today's totals, a per-salesperson table, follow-ups due, and a CSV export.

## Security notes (light protection — please read)

- There are no user accounts. Every phone signs in to Firebase anonymously. Rules allow reads and writes only to
  signed-in users who know the Team code path (`/teams/{teamCode}/records`). The team list itself can't be read,
  and records can't be hard-deleted.
- Salesperson PINs and the owner PIN are **device locks only**. Anyone who knows the Team code can read the data,
  including a salesperson who opens owner.html. Change the Team code (on every phone and the panel) if someone leaves.
- Do not put customer bank details or passwords in the notes fields.
- Free Spark plan limits: 50,000 reads and 20,000 writes per day, 1 GiB storage. That's plenty for 1–3 salespeople.

## Data & backup

- Every phone keeps its full history in its browser storage. Use **Settings → Export CSV** (opens in Excel) and
  **Backup (JSON)** every week. **Restore** merges a backup back in.
- Clearing Chrome's site data or uninstalling Chrome deletes the on-phone copy. Synced entries stay in Firebase.
