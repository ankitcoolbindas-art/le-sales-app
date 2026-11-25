/* LE Sales v2 — data layer: Firebase Auth (email/password) + Firestore, offline-first queue */
const DB = (() => {
  const cfg = window.LE_FIREBASE;
  const EMU = /[?&]emu=1/.test(location.search) && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  let auth, db, unsubs = [], flushing = false, again = false;
  const S = {profileErr: false, user: null, profile: null, records: new Map(), openQ: new Map(), users: new Map(), targets: new Map(), state: 'connecting', loaded: false, indexFallback: false};
  const subs = new Set();
  const emit = (what) => subs.forEach(f => f(what));
  const lsKey = k => `le2_${k}_${S.user ? S.user.uid : 'x'}`;
  const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(lsKey(k))) ?? d; } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(lsKey(k), JSON.stringify(v)); } catch (e) { console.warn('storage full', e); } };
  const pending = () => lsGet('pending', []);
  const setPending = a => lsSet('pending', [...new Set(a)]);
  const isMgr = () => S.profile && ['admin', 'manager'].includes(S.profile.role);
  const isAdmin = () => S.profile && S.profile.role === 'admin';

  function init() {
    firebase.initializeApp(cfg);
    auth = firebase.auth(); db = firebase.firestore();
    if (EMU) { auth.useEmulator('http://127.0.0.1:9099', {disableWarnings: true}); db.useEmulator('127.0.0.1', 8080); }
    else db.enablePersistence({synchronizeTabs: true}).catch(() => {});
    auth.onAuthStateChanged(onAuth);
    addEventListener('online', () => { setState('live'); flush(); });
    addEventListener('offline', () => setState('offline'));
  }
  function setState(s) { S.state = navigator.onLine ? s : 'offline'; emit('state'); }

  async function onAuth(user) {
    unsubs.forEach(u => u()); unsubs = [];
    S.user = user; S.profile = null; S.records = new Map(); S.openQ = new Map(); S.users = new Map(); S.targets = new Map(); S.loaded = false;
    if (!user) { emit('auth'); return; }
    // local own records first (offline start)
    lsGet('recs', []).forEach(r => S.records.set(r.id, r));
    const cached = lsGet('profile', null);
    try {
      const snap = await db.collection('users').doc(user.uid).get();
      S.profile = snap.exists ? snap.data() : null; S.profileErr = false;
      if (S.profile) lsSet('profile', S.profile); else localStorage.removeItem(lsKey('profile'));
    } catch (e) {
      console.warn('profile load failed', e);
      if (e.code === 'permission-denied') { S.profile = null; S.profileErr = false; S.denied = true; }
      else { S.profile = cached; S.profileErr = !cached; }   // offline: trust the last known profile, rules still enforce on sync
    }
    emit('auth');
    if (S.profile && S.profile.active) start();
  }

  function start() {
    const uid = S.user.uid, from = LE.addDays(LE.today(), -(isMgr() ? MGR_DAYS : WINDOW_DAYS)), recs = db.collection('records');
    // live profile (deactivation takes effect immediately)
    unsubs.push(db.collection('users').doc(uid).onSnapshot(s => { if (!s.exists) return; const p = s.data(); const was = S.profile; S.profile = p; lsSet('profile', p); if (!was || was.active !== p.active || was.role !== p.role) emit('auth'); else emit('data'); }, err));
    const put = (docs, map) => docs.forEach(d => { const r = d.data(), cur = map.get(r.id); if (!cur || (r.upd || 0) >= (cur.upd || 0) || !pending().includes(r.id)) map.set(r.id, r); });
    if (isMgr()) {
      unsubs.push(recs.where('date', '>=', from).orderBy('date', 'desc').limit(5000).onSnapshot(s => { put(s.docs, S.records); S.loaded = true; setState('live'); emit('data'); }, err));
      unsubs.push(recs.where('open', '==', true).limit(2000).onSnapshot(s => { S.openQ = new Map(s.docs.map(d => [d.id, d.data()])); emit('data'); }, err));
      unsubs.push(db.collection('users').onSnapshot(s => { S.users = new Map(s.docs.map(d => [d.id, {uid: d.id, ...d.data()}])); emit('data'); }, err));
      unsubs.push(db.collection('targets').where('month', '>=', LE.month(LE.addDays(LE.today(), -95))).onSnapshot(s => { S.targets = new Map(s.docs.map(d => [d.id, d.data()])); emit('data'); }, err));
    } else {
      const own = () => recs.where('ownerUid', '==', uid).where('date', '>=', from).orderBy('date', 'desc').limit(3000);
      const ownFallback = () => recs.where('ownerUid', '==', uid).limit(3000);
      const listen = (q, fb) => unsubs.push(q().onSnapshot(s => { put(s.docs, S.records); saveLocal(); S.loaded = true; setState('live'); emit('data'); },
        e => { if (e.code === 'failed-precondition' && fb) { console.warn('composite index missing — using fallback query', e.message); S.indexFallback = true; listen(fb, null); } else err(e); }));
      listen(own, ownFallback);
      unsubs.push(recs.where('ownerUid', '==', uid).where('open', '==', true).onSnapshot(s => { S.openQ = new Map(s.docs.map(d => [d.id, d.data()])); emit('data'); }, err));
      unsubs.push(db.collection('targets').where('uid', '==', uid).onSnapshot(s => { S.targets = new Map(s.docs.map(d => [d.id, d.data()])); emit('data'); }, err));
    }
    flush();
  }
  function err(e) { console.warn('firestore', e); if (e.code === 'permission-denied') { setState('denied'); } else setState('error'); emit('error'); }

  function saveLocal() {
    const from = LE.addDays(LE.today(), -WINDOW_DAYS), p = pending();
    lsSet('recs', [...S.records.values()].filter(r => r.ownerUid === S.user.uid && (r.date >= from || p.includes(r.id))));
  }

  /* ---- writes ---- */
  function save(r) {
    const now = Date.now();
    r.id = r.id || LE.uid(); r.ts = r.ts || now; r.upd = now; r.date = r.date || LE.today();
    if (!r.ownerUid) { r.ownerUid = S.user.uid; r.ownerName = S.profile.name; r.territory = S.profile.territory || ''; }
    r.customerKey = LE.key(r.customer); r.open = LE.isOpen(r);
    Object.keys(r).forEach(k => (r[k] === undefined || r[k] === '') && delete r[k]);
    S.records.set(r.id, r); if (r.kind === 'quote') { r.open ? S.openQ.set(r.id, r) : S.openQ.delete(r.id); }
    setPending([...pending(), r.id]); saveLocal(); emit('data'); flush();
    return r;
  }
  async function flush() {
    if (!S.user || !S.profile) return;
    if (flushing) { again = true; return; }
    flushing = true;
    try {
      do {
        again = false;
        for (const id of pending()) {
          const r = S.records.get(id);
          if (!r) { setPending(pending().filter(x => x !== id)); continue; }
          await db.collection('records').doc(id).set(JSON.parse(JSON.stringify(r)), {merge: true});
          setPending(pending().filter(x => x !== id));
        }
      } while (again || pending().length);
      setState('live'); saveLocal();
    } catch (e) { console.warn('flush failed', e); setState(e.code === 'permission-denied' ? 'denied' : 'error'); }
    finally { flushing = false; emit('state'); }
  }

  /* ---- auth actions ---- */
  const login = (email, pw) => auth.signInWithEmailAndPassword(email.trim(), pw);
  const logout = () => auth.signOut();
  const resetPw = email => auth.sendPasswordResetEmail(email.trim());
  async function ownerSignup(pw) {
    const c = await auth.createUserWithEmailAndPassword(BOOT_EMAIL, pw);
    await c.user.sendEmailVerification().catch(e => console.warn(e));
    return c.user;
  }
  const resendVerify = () => auth.currentUser.sendEmailVerification();
  async function claimAdmin(name, phone) {
    const u = auth.currentUser; await u.reload();
    if (!auth.currentUser.emailVerified) throw new Error('Email not verified yet. Open the link we emailed to ' + BOOT_EMAIL + ', then tap Continue.');
    await auth.currentUser.getIdToken(true);
    const p = {name: name || 'Ankit Kumar Mahto', email: BOOT_EMAIL, phone: phone || '', role: 'admin', territory: 'All', active: true, createdAt: Date.now(), createdBy: 'bootstrap', mustChangePassword: false};
    await db.collection('users').doc(u.uid).set(p);
    await onAuth(auth.currentUser);
  }
  async function changePassword(pw) {
    await auth.currentUser.updatePassword(pw);
    if (S.profile && S.profile.mustChangePassword) await db.collection('users').doc(S.user.uid).update({mustChangePassword: false, updatedAt: Date.now()});
    S.profile.mustChangePassword = false; emit('auth');
  }

  /* ---- admin ---- */
  async function createEmployee({name, email, phone, role, territory, password}) {
    if (!isAdmin()) throw new Error('Only the admin can add employees.');
    const sec = firebase.initializeApp(cfg, 'sec' + Date.now());
    try {
      const sa = sec.auth(); if (EMU) sa.useEmulator('http://127.0.0.1:9099', {disableWarnings: true});
      const c = await sa.createUserWithEmailAndPassword(email.trim().toLowerCase(), password);
      const uid = c.user.uid; await sa.signOut();
      await db.collection('users').doc(uid).set({name: name.trim(), email: email.trim().toLowerCase(), phone: phone || '', role, territory: territory || '', active: true, createdAt: Date.now(), createdBy: S.user.uid, mustChangePassword: true});
      return uid;
    } finally { sec.delete().catch(() => {}); }
  }
  const updateUser = (uid, patch) => { const cur = S.users.get(uid) || {}; const {uid: _u, ...rest} = {...cur, ...patch, updatedAt: Date.now()}; return db.collection('users').doc(uid).set(rest); };
  const setTarget = (uid, month, t) => db.collection('targets').doc(`${uid}_${month}`).set({uid, month, sales: +t.sales || 0, collection: +t.collection || 0, visits: +t.visits || 0, updatedAt: Date.now(), updatedBy: S.user.uid});
  async function customerHistory(key) {
    let q = db.collection('records').where('customerKey', '==', key);
    if (!isMgr()) q = q.where('ownerUid', '==', S.user.uid);
    const s = await q.limit(500).get();
    return s.docs.map(d => d.data()).filter(r => !r.deleted).sort((a, b) => b.ts - a.ts);
  }

  return {S, init, on: f => subs.add(f), save, flush, pending, login, logout, resetPw, ownerSignup, resendVerify, claimAdmin, changePassword,
    createEmployee, updateUser, setTarget, customerHistory, isMgr, isAdmin, get auth() { return auth; }, EMU};
})();
