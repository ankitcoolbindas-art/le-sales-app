/* Optional live sync via Firebase Firestore (compat SDK from CDN).
 * Offline-first: the app always saves to the phone first; ids are queued in localStorage
 * and pushed when online. If no config / team code, everything stays local. */
const LESync = (() => {
  const V = '10.12.2', CDN = `https://www.gstatic.com/firebasejs/${V}/`;
  const PKEY = 'le_pending';
  let col = null, state = 'local', starting = null, flushing = false;
  const subs = new Set();
  const setState = s => { state = s; subs.forEach(f => f(s)); };
  const load = src => new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('load ' + src)); document.head.appendChild(s); });
  const pending = () => { try { return JSON.parse(localStorage.getItem(PKEY) || '[]'); } catch { return []; } };
  const savePending = a => localStorage.setItem(PKEY, JSON.stringify([...new Set(a)]));
  const configured = () => !!(window.LE_FIREBASE && window.LE_FIREBASE.apiKey && window.LE_FIREBASE.projectId);

  async function start(team) {
    if (!configured() || !team) { setState('local'); return false; }
    if (col) return true;
    if (starting) return starting;
    starting = (async () => {
      try {
        setState('connecting');
        if (!window.firebase) { await load(CDN + 'firebase-app-compat.js'); await Promise.all([load(CDN + 'firebase-auth-compat.js'), load(CDN + 'firebase-firestore-compat.js')]); }
        if (!firebase.apps.length) firebase.initializeApp(window.LE_FIREBASE);
        const db = firebase.firestore();
        try { await db.enablePersistence({synchronizeTabs: true}); } catch (e) { /* already enabled / unsupported */ }
        const auth = firebase.auth();
        await new Promise(r => { const u = auth.onAuthStateChanged(x => { u(); r(x); }); });
        if (!auth.currentUser) await auth.signInAnonymously();
        col = db.collection('teams').doc(team).collection('records');
        setState(navigator.onLine ? 'live' : 'offline');
        return true;
      } catch (e) { console.warn('sync start failed', e); setState(navigator.onLine ? 'error' : 'offline'); return false; }
      finally { starting = null; }
    })();
    return starting;
  }

  function queue(id) { savePending([...pending(), id]); }

  let again = false;
  async function flush(getRec) {
    if (!col) return;
    if (flushing) { again = true; return; }   // new entries saved mid-flush get picked up below
    flushing = true;
    try {
      do {
        again = false;
        for (const id of pending()) {
          const r = getRec(id);
          if (!r) { savePending(pending().filter(x => x !== id)); continue; }
          const clean = JSON.parse(JSON.stringify(r)); clean.open = LE.isOpen(r);
          await col.doc(id).set(clean, {merge: true});  // resolves after server ack
          savePending(pending().filter(x => x !== id));
        }
      } while (again || pending().length);
      if (navigator.onLine) setState('live');
    } catch (e) { console.warn('flush failed', e); setState(navigator.onLine ? 'error' : 'offline'); }
    finally { flushing = false; }
  }

  /* owner: live listeners. cb(records[], changes[]) */
  function watch(query, cb, onErr) {
    return query(col).onSnapshot({includeMetadataChanges: false}, snap => {
      cb(snap.docs.map(d => d.data()), snap.docChanges().filter(c => c.type !== 'removed' && !snap.metadata.fromCache).map(c => c.doc.id));
    }, e => { console.warn(e); onErr && onErr(e); });
  }

  addEventListener('online', () => { if (col) setState('live'); subs.forEach(f => f('online')); });
  addEventListener('offline', () => { if (col) setState('offline'); });
  return { start, queue, flush, watch, pending, configured, onState: f => subs.add(f), get state() { return state; } };
})();
