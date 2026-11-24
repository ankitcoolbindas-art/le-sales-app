/* Live sync config for LE Sales.
 * Leave LE_FIREBASE = null to run local-only (data stays on the phone, daily report via WhatsApp).
 * To turn on real-time sync to the owner panel, paste your Firebase web config below (see SETUP.md), e.g.:
 *
 * window.LE_FIREBASE = {
 *   apiKey: "AIza...",
 *   authDomain: "le-sales-xxxx.firebaseapp.com",
 *   projectId: "le-sales-xxxx",
 *   storageBucket: "le-sales-xxxx.appspot.com",
 *   messagingSenderId: "1234567890",
 *   appId: "1:1234567890:web:abcdef"
 * };
 *
 * The Firebase web config is not a secret (Google designs it to be public). Access is controlled by
 * firestore.rules + the private Team code that you type into each phone — never put the Team code here.
 */
window.LE_FIREBASE = null;
