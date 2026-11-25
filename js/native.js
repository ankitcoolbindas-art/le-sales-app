/* LE Sales — native bridge (Android/iOS app only). Does nothing in a normal browser.
 * Loaded by index.html right after js/data.js (before js/ui.js, so it can relay 'track' events to the UI). In the LE Sales app it replaces the open-app-only web
 * tracker (DB.Track) with all-day tracking:
 *   Android: native foreground service (LENative plugin) — writes Firestore itself, survives screen-off/swipe-away.
 *   iOS:     @capacitor-community/background-geolocation + native HTTP (CapacitorHttp).
 * Tracking runs only while the salesperson is signed in AND has tapped "Start day"; stops on End day,
 * sign-out, or automatically at 9 PM. Writes the same docs as the web tracker with source:'android'
 * (iOS also uses 'android' because firestore.rules only allow 'web'|'android'; deviceId says iPhone). */
(() => {
  const Cap = window.Capacitor;
  if (!Cap || !Cap.isNativePlatform || !Cap.isNativePlatform() || typeof DB === 'undefined') return;
  const PLATFORM = Cap.getPlatform();               // 'android' | 'ios'
  const STOP_HOUR = 21, SEND_EVERY = 180000, MOVE_M = 100, MOVE_GAP = 60000;
  const N = Cap.Plugins.LENative;                    // Android only
  const BG = PLATFORM === 'ios' ? Cap.registerPlugin('BackgroundGeolocation') : null;
  const HTTP = Cap.Plugins.CapacitorHttp;
  window.LE_NATIVE = {platform: PLATFORM};
  // v1.1 app (Android): in-app live camera + native fix with fake-GPS detection. Older installs keep the v1.0 behaviour.
  const gte = (a, b) => { const x = String(a || '0').split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== y[i]) return (x[i] || 0) > y[i]; } return true; };
  window.LE_NATIVE.ready = PLATFORM !== 'android' ? Promise.resolve() : Cap.Plugins.LENative.status().then(s => {
    window.LE_NATIVE.appVersion = s.appVersion;
    if (gte(s.appVersion, '1.1.0')) Object.assign(window.LE_NATIVE, {liveCamera: true, mockCheck: true,
      fix: o => Cap.Plugins.LENative.currentFix(o || {}), mockStatus: () => Cap.Plugins.LENative.mockStatus(), openSettings: () => Cap.Plugins.LENative.openAppSettings()});
  }).catch(() => {});
  document.documentElement.classList.add('le-native', 'le-' + PLATFORM);
  const S = DB.S;
  const isSales = () => S.user && S.profile && S.profile.active && S.profile.role === 'sales';
  const lsk = k => 'le_nat_' + k + '_' + (S.user ? S.user.uid : 'x');
  const today = () => LE.today();
  const afterHours = () => new Date().getHours() >= STOP_HOUR;
  const fmt = ts => ts ? LE.time(ts) : '—';
  let st = {active: false};                          // last known native status
  let poll = null, prompted = false;

  /* ---------------- iOS engine (JS + background-geolocation) ---------------- */
  const IOS = (() => {
    let watcher = null, last = null, lastAt = 0, tok = null, tokExp = 0, sending = false;
    const K = () => 'le_ios_' + (S.user ? S.user.uid : 'x');
    const load = () => { try { return JSON.parse(localStorage.getItem(K())) || {}; } catch { return {}; } };
    const save = o => localStorage.setItem(K(), JSON.stringify(o));
    const dist = (a, b) => { const R = 6371000, r = x => x * Math.PI / 180, dLa = r(b.lat - a.lat), dLo = r(b.lng - a.lng);
      const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
    async function token() {
      if (tok && Date.now() < tokExp - 120000) return tok;
      const u = DB.auth.currentUser; if (!u) throw new Error('Not signed in');
      const r = await HTTP.request({url: 'https://securetoken.googleapis.com/v1/token?key=' + encodeURIComponent(LE_FIREBASE.apiKey), method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded'}, data: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(u.refreshToken)});
      if (r.status !== 200) throw new Error('token ' + r.status);
      const j = typeof r.data === 'string' ? JSON.parse(r.data) : r.data; tok = j.id_token; tokExp = Date.now() + (+j.expires_in || 3600) * 1000; return tok;
    }
    const val = v => typeof v === 'boolean' ? {booleanValue: v} : Number.isInteger(v) ? {integerValue: String(v)} : typeof v === 'number' ? {doubleValue: v} : {stringValue: String(v)};
    const fields = d => Object.fromEntries(Object.entries(d).filter(([, v]) => v != null && !(typeof v === 'number' && isNaN(v))).map(([k, v]) => [k, val(v)]));
    async function flush() {
      const o = load(); if (sending || !o.queue || !o.queue.length) return; sending = true;
      try {
        const t = await token(), base = `projects/${LE_FIREBASE.projectId}/databases/(default)/documents/`, batch = o.queue.slice(0, 100);
        const latest = batch.reduce((a, b) => (!a || b.ts >= a.ts ? b : a), null);
        const url = `https://firestore.googleapis.com/v1/${base.slice(0, -1)}:commit`;
        const commit = async writes => (await HTTP.request({url, method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + t}, data: {writes}})).status;
        const locW = batch.map(d => ({update: {name: base + 'locations/' + d.ownerUid + '_' + d.ts.toString(36) + 'i', fields: fields({...d, updatedAt: Date.now()})}}));
        const lastW = {update: {name: base + 'lastLocation/' + latest.ownerUid, fields: fields({...latest, updatedAt: Date.now()})}};
        let code = await commit([...locW, lastW]);   // atomic, checked by firestore.rules
        if (code === 401) { tok = null; throw new Error('sign-in expired'); }
        if (code === 403 || code === 400 || code === 409) { for (const x of locW) { const c = await commit([x]); if (c >= 500) throw new Error('server ' + c); } await commit([lastW]); }
        else if (code !== 200) throw new Error('server ' + code);
        const n = load(); n.queue = (n.queue || []).slice(batch.length); n.sent = (n.sent || 0) + batch.length; n.lastSentAt = Date.now(); n.err = ''; save(n);
      } catch (e) { const n = load(); n.err = String(e.message || e); save(n); }
      finally { sending = false; }
    }
    function onFix(l, e) {
      if (e) { const o = load(); o.err = e.code === 'NOT_AUTHORIZED' ? 'Location permission denied' : e.message; save(o); refresh(); return; }
      if (!l) return;
      const o = load();
      if (!o.active || o.day !== today() || afterHours()) { stop('auto-stop'); return; }
      const f = {lat: l.latitude, lng: l.longitude, accuracy: l.accuracy, ts: l.time || Date.now(), speed: l.speed, heading: l.bearing};
      o.lastFixAt = Date.now(); const now = Date.now(); let reason = null;
      if (!last) reason = 'start'; else if (now - lastAt >= SEND_EVERY) reason = 'interval';
      else if (now - lastAt >= MOVE_GAP && dist(last, f) >= MOVE_M && f.accuracy < 200) reason = 'move';
      if (reason) { last = f; lastAt = now; (o.queue = o.queue || []).push(doc(f, reason)); if (o.queue.length > 1500) o.queue.splice(0, o.queue.length - 1500); }
      save(o); if (reason) flush().then(refresh);
    }
    const doc = (f, reason) => ({ownerUid: S.user.uid, ownerName: S.profile.name, lat: f.lat, lng: f.lng, accuracy: Math.round(f.accuracy || 0), ts: Math.round(f.ts),
      date: LE.dstr(f.ts), source: 'android', reason, deviceId: 'iPhone', appVersion: 'ios-1.0.0', speed: f.speed ?? undefined, heading: f.heading ?? undefined});
    async function start() {
      const o = load(); if (o.day !== today()) { o.sent = 0; o.queue = []; o.startedAt = Date.now(); }
      Object.assign(o, {active: true, day: today(), err: ''}); save(o);
      if (watcher) return;
      watcher = await BG.addWatcher({backgroundTitle: 'Lalit Enterprises — location sharing on', backgroundMessage: 'Work day started', requestPermissions: true, stale: false, distanceFilter: 25}, onFix);
    }
    async function stop(why) {
      const o = load(); o.active = false; o.endReason = why; o.endedAt = Date.now(); save(o);
      if (watcher) { const w = watcher; watcher = null; await BG.removeWatcher({id: w}).catch(() => {}); }
      last = null; await flush(); refresh();
    }
    const status = () => { const o = load(); return {active: !!o.active && o.day === today() && !afterHours(), running: !!watcher, lastSentAt: o.lastSentAt || 0, lastFixAt: o.lastFixAt || 0,
      sentCount: o.sent || 0, queued: (o.queue || []).length, lastError: o.err || '', endReason: o.endReason || '', stopHour: STOP_HOUR, uid: S.user && S.user.uid}; };
    const checkin = f => { const o = load(); if (!o.active) return; (o.queue = o.queue || []).push(doc({lat: f.lat, lng: f.lng, accuracy: f.accuracy || 0, ts: f.gpsTs || Date.now()}, 'checkin')); save(o); flush(); };
    return {start, stop, status, checkin};
  })();

  /* ---------------- engine facade ---------------- */
  const E = {
    async status() { return PLATFORM === 'android' ? N.trackingStatus() : IOS.status(); },
    async start() {
      if (PLATFORM === 'ios') return IOS.start();
      const u = DB.auth.currentUser; if (!u) throw new Error('Not signed in');
      return N.startTracking({emuHost: DB.EMU ? '127.0.0.1' : '', uid: u.uid, name: S.profile.name || '', refreshToken: u.refreshToken, apiKey: LE_FIREBASE.apiKey, projectId: LE_FIREBASE.projectId, stopHour: STOP_HOUR});
    },
    async stop(reason, forget) { return PLATFORM === 'android' ? N.stopTracking({reason, forget: !!forget}) : IOS.stop(reason); },
    checkin(f) { if (PLATFORM === 'android') N.checkin({lat: f.lat, lng: f.lng, accuracy: f.accuracy || 0, ts: f.gpsTs || Date.now()}).catch(() => {}); else IOS.checkin(f); }
  };

  /* capture UI subscribers (ui.js registers after this file) so we can tell it the tracking state changed */
  const uiSubs = []; const _on = DB.on;
  DB.on = f => { uiSubs.push(f); return _on(f); };
  const emitTrack = () => uiSubs.forEach(f => { try { f('track'); } catch {} });

  /* ---------------- replace the web tracker ---------------- */
  const T = DB.Track;
  if (T) {
    T.start = () => { refresh(true); };               // called after sign-in for salespeople
    T.retry = () => startDay();
    T.checkin = f => { if (f && f.lat != null) E.checkin(f); };
    T.stop = () => setTimeout(async () => {          // called on every auth change — only end the day on real sign-out/deactivation
      if (!S.user || (S.profile && (!S.profile.active || S.profile.role !== 'sales'))) {
        const s = await E.status().catch(() => ({})); if (s.active) await E.stop('signed-out', true).catch(() => {});
      }
      refresh();
    }, 0);
  }

  /* ---------------- UI ---------------- */
  const css = document.createElement('style');
  css.textContent = `
  .le-day{position:fixed;left:16px;bottom:calc(84px + env(safe-area-inset-bottom));z-index:46;display:none;align-items:center;gap:8px;height:46px;padding:0 16px 0 12px;border-radius:23px;border:1px solid var(--line,rgba(255,255,255,.08));background:rgba(17,22,32,.96);color:var(--tx,#eef2f8);font:600 14px var(--ff,system-ui);box-shadow:0 10px 28px -10px rgba(0,0,0,.7);cursor:pointer}
  .le-day.show{display:flex}.le-day i{width:10px;height:10px;border-radius:50%;background:var(--dim,#77829a)}
  .le-day.on i{background:var(--green,#3ddc97);box-shadow:0 0 0 4px rgba(61,220,151,.18)}.le-day.warn i{background:var(--amber,#ffc53d)}
  .le-day.off{background:linear-gradient(135deg,var(--amber,#ffc53d),#ff9f1a);color:#1a1203;border:0}
  .le-day.off i{display:none}
  .le-sheet-bg{position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;justify-content:center}
  .le-sheet{width:100%;max-width:520px;max-height:88vh;overflow:auto;background:var(--card,#111620);color:var(--tx,#eef2f8);border-radius:22px 22px 0 0;padding:22px 20px calc(20px + env(safe-area-inset-bottom));font:15px/1.45 var(--ff,system-ui)}
  .le-sheet h2{margin:0 0 6px;font:700 20px var(--fd,system-ui)}.le-sheet .hi{color:var(--mut,#a3adbf);font-size:14px;margin:4px 0 12px}
  .le-sheet .row{display:flex;align-items:center;gap:10px;padding:11px 0;border-top:1px solid var(--line,rgba(255,255,255,.08))}
  .le-sheet .row b{flex:1;font-weight:600}.le-sheet .row small{display:block;color:var(--dim,#77829a);font-weight:400;font-size:12.5px}
  .le-sheet .le-ok{color:var(--green,#3ddc97);font-weight:700}.le-sheet .le-no{color:var(--amber,#ffc53d);font-weight:700}
  .le-sheet button{font:600 14px var(--ff,system-ui);border-radius:12px;padding:10px 14px;border:1px solid var(--line,rgba(255,255,255,.12));background:transparent;color:inherit}
  .le-sheet button.pri{background:linear-gradient(135deg,var(--amber,#ffc53d),#ff9f1a);color:#1a1203;border:0}
  .le-sheet button.red{background:rgba(255,107,107,.14);color:var(--red,#ff6b6b);border-color:rgba(255,107,107,.35)}
  .le-sheet .acts{display:flex;gap:10px;margin-top:16px}.le-sheet .acts button{flex:1;padding:14px}
  @media(min-width:900px){.le-day{bottom:28px;left:calc(var(--sb,248px) + 24px)}}`;
  document.head.appendChild(css);
  const pill = document.createElement('div'); pill.className = 'le-day'; pill.setAttribute('role', 'button');
  pill.addEventListener('click', () => sheet());
  const mount = () => document.body.appendChild(pill);
  document.body ? mount() : addEventListener('DOMContentLoaded', mount);

  function paintPill() {
    if (!isSales()) { pill.classList.remove('show'); return; }
    pill.classList.add('show');
    if (st.active && st.mockAt && Date.now() - st.mockAt < 15 * 60000) {
      pill.className = 'le-day show warn'; pill.innerHTML = '<i></i><span>⚠ Fake GPS detected · turn it off</span>';
    } else if (st.active) {
      const warn = st.lastError || (st.lastSentAt && Date.now() - st.lastSentAt > 15 * 60000);
      pill.className = 'le-day show ' + (warn ? 'warn' : 'on');
      pill.innerHTML = `<i></i><span>Day on · ${st.lastSentAt ? 'sent ' + fmt(st.lastSentAt) : 'starting…'}</span>`;
    } else {
      pill.className = 'le-day show off';
      pill.innerHTML = afterHours() ? '<span>Day ended · दिन समाप्त</span>' : '<span>▶ Start day · दिन शुरू करें</span>';
    }
  }
  function syncWebState() {                          // feed the web app's own location pill (S.track) if present
    if (!S.track) return;
    S.track.state = st.active ? 'on' : 'off';
    S.track.lastWrite = st.lastSentAt || 0; S.track.count = st.sentCount || 0;
    S.track.err = st.active ? (st.lastError || '') : (afterHours() ? 'day ended' : 'tap Start day');
    emitTrack();
  }
  async function refresh(fromSignIn) {
    if (S.user) try { localStorage.setItem('le2_locnotice_' + S.user.uid, '1'); } catch {}   // the app shows its own Start day disclosure instead of the web 'while open' notice
    try { st = await E.status(); } catch { st = {active: false}; }
    if (st.active && S.user && st.uid && st.uid !== S.user.uid) { await E.stop('other-user', true).catch(() => {}); st = {active: false}; }
    // re-arm after the app was restarted mid-day (also refreshes the sign-in token the service uses)
    if (fromSignIn && isSales() && st.active && PLATFORM === 'android') { try { st = await E.start(); } catch {} }
    if (fromSignIn && isSales() && st.active && PLATFORM === 'ios') { try { await IOS.start(); st = IOS.status(); } catch {} }
    paintPill(); syncWebState();
    const sh = document.querySelector('.le-sheet[data-k="main"]'); if (sh) sheet(true);
    if (fromSignIn && isSales() && !st.active && !afterHours() && !prompted && !(S.profile && S.profile.mustChangePassword)) { prompted = true; setTimeout(() => sheet(), 900); }
    clearInterval(poll); if (isSales()) poll = setInterval(() => { if (!document.hidden) refresh(); }, 20000);
  }

  const close = () => document.querySelectorAll('.le-sheet-bg').forEach(x => x.remove());
  function open(html, k) {
    close();
    const bg = document.createElement('div'); bg.className = 'le-sheet-bg';
    bg.innerHTML = `<div class="le-sheet" data-k="${k || ''}">${html}</div>`;
    bg.addEventListener('click', e => { if (e.target === bg) close(); });
    document.body.appendChild(bg); return bg;
  }
  const wait = ms => new Promise(r => setTimeout(r, ms));
  async function waitFor(check, ms = 45000) { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return true; await wait(800); } return false; }
  const OEM = m => /xiaomi|redmi|poco/i.test(m) ? 'Xiaomi/Redmi/POCO' : /vivo|iqoo/i.test(m) ? 'Vivo/iQOO' : /oppo|realme|oneplus/i.test(m) ? 'Oppo/Realme/OnePlus' : /samsung/i.test(m) ? 'Samsung' : /huawei|honor/i.test(m) ? 'Huawei/Honor' : '';

  async function sheet(repaint) {
    if (!isSales()) return;
    let p = {};
    if (PLATFORM === 'android') { try { p = await N.status(); } catch {} }
    const oem = OEM(p.manufacturer || '');
    const row = (ok, t, sub, act, btn) => `<div class="row"><span class="${ok ? 'le-ok' : 'le-no'}">${ok ? '✓' : '!'}</span><b>${t}<small>${sub}</small></b>${ok || !act ? '' : `<button data-a="${act}">${btn || 'Fix'}</button>`}</div>`;
    const checks = PLATFORM !== 'android' ? '' :
      row(p.locationOn, 'Phone location (GPS) on', 'फ़ोन की लोकेशन चालू रखें', 'gps', 'Turn on') +
      row(p.fine, 'Location permission', 'Allow → "Precise" / सटीक लोकेशन', 'perm', 'Allow') +
      row(p.background, 'Allow all the time', 'Settings → Permissions → Location → "Allow all the time" / "हमेशा अनुमति दें"', 'bgperm', 'Open') +
      row(p.notifications, 'Notifications', 'Needed for the "location sharing on" notice / सूचना दिखाने के लिए', 'notif', 'Allow') +
      row(p.batteryUnrestricted, 'Battery: unrestricted', 'So the phone does not stop sharing / बैटरी पाबंदी हटाएँ', 'battery', 'Allow') +
      (oem ? `<div class="row"><span class="le-no">i</span><b>${oem}: Autostart / background<small>${oem.startsWith('Xiaomi') ? 'Security → Autostart → LE Sales ON; App info → Battery saver → No restrictions' : oem.startsWith('Vivo') ? 'i Manager → App manager → Autostart ON; Battery → Background power → Allow high usage' : oem.startsWith('Oppo') ? 'App info → Battery → Allow background activity + Auto launch ON' : oem === 'Samsung' ? 'Battery → Background usage limits → remove LE Sales from Sleeping apps' : 'Allow LE Sales to auto-launch and run in background'}. Also lock LE Sales in Recent apps (🔒).</small></b><button data-a="autostart">Open</button></div>` : '');
    const status = st.active
      ? `<p class="hi">Sharing your location with Lalit Enterprises since ${fmt(st.startedAt)} · last sent ${fmt(st.lastSentAt)} · ${st.sentCount || 0} update(s) today${st.queued ? ` · ${st.queued} waiting for internet` : ''}. Auto-stops at ${STOP_HOUR - 12} PM.</p>${st.lastError ? `<p class="hi" style="color:var(--amber,#ffc53d)">⚠ ${LE.esc(st.lastError)}</p>` : ''}${st.mockAt && Date.now() - st.mockAt < 15 * 60000 ? '<p class="hi" style="color:var(--red,#ff6b6b)"><b>⚠ Fake GPS detected.</b> Turn off / uninstall the mock-location app. Your positions are marked FAKE for the owner. नकली GPS ऐप बंद करें।</p>' : ''}`
      : `<p class="hi">${afterHours() ? `Your day has ended (auto-stop at ${STOP_HOUR - 12} PM). See you tomorrow!` : 'Tap <b>Start day</b> when you begin field work. Your location is shared with Lalit Enterprises every ~3 minutes and when you move — <b>even when the app is closed or not in use</b> — until you tap End day (auto-stops at 9 PM).'}</p>
         <p class="hi">काम शुरू करते समय <b>Start day</b> दबाएँ। दिन भर हर ~3 मिनट में और चलने पर आपकी लोकेशन Lalit Enterprises को भेजी जाएगी। <b>End day</b> दबाने पर या रात 9 बजे अपने-आप बंद हो जाएगी।</p>`;
    const acts = st.active
      ? `<div class="acts"><button data-a="close">Close</button><button class="red" data-a="end">End day · दिन खत्म</button></div>`
      : `<div class="acts"><button data-a="close">Later</button>${afterHours() ? '' : '<button class="pri" data-a="start">▶ Start day · दिन शुरू</button>'}</div>`;
    const html = `<h2>${st.active ? '🟢 Day started' : 'Location sharing'}</h2>${status}${checks}${acts}`;
    const cur = document.querySelector('.le-sheet[data-k="main"]');
    if (repaint && cur) { cur.innerHTML = html; } else if (repaint) return; else open(html, 'main');
  }

  document.addEventListener('click', async e => {
    const b = e.target.closest('.le-sheet [data-a]'); if (!b) return;
    const a = b.dataset.a;
    try {
      if (a === 'close') close();
      else if (a === 'start') await startDay();
      else if (a === 'end') { if (confirm('End your work day and stop sharing location?\nदिन खत्म करें और लोकेशन शेयरिंग बंद करें?')) { await E.stop('end-day'); LE.toast('Day ended · location sharing off'); close(); await refresh(); } }
      else if (a === 'gps') await N.openLocationSettings();
      else if (a === 'perm') { await N.requestForegroundLocation(); await waitFor(async () => (await N.status()).fine, 30000); sheet(true); }
      else if (a === 'bgperm') await explainBackground();
      else if (a === 'notif') { await N.requestNotifications(); await wait(1500); const s = await N.status(); if (!s.notifications) await N.openAppSettings(); sheet(true); }
      else if (a === 'battery') await N.requestBatteryUnrestricted();
      else if (a === 'autostart') await N.openAutostart();
    } catch (err) { LE.toast(LE.errMsg(err)); }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { refresh(); setTimeout(() => sheet(true), 300); } });

  async function explainBackground() {
    alert('Next screen: tap "Location" → choose "Allow all the time".\n\nअगली स्क्रीन पर "Location" → "Allow all the time / हमेशा अनुमति दें" चुनें।\n\nThis keeps location sharing working when the phone is locked.');
    await N.requestBackgroundLocation(); await wait(1200);
    const s = await N.status(); if (!s.background) await N.openAppSettings();
  }

  async function startDay() {
    if (!isSales()) return LE.toast('Only salespeople share location.');
    if (afterHours()) return LE.toast(`After ${STOP_HOUR - 12} PM — start your day tomorrow.`);
    if (PLATFORM === 'android') {
      let s = await N.status();
      if (!s.locationOn) { alert('Please turn ON phone location (GPS), then come back and tap Start day.\nफ़ोन की लोकेशन (GPS) चालू करें, फिर वापस आकर Start day दबाएँ।'); await N.openLocationSettings(); return; }
      if (!s.fine) {
        alert('LE Sales collects your location to share it with Lalit Enterprises during your work day — every few minutes and when you move, even when the app is closed or not in use — until you tap End day (auto-stops at 9 PM).\nPlease tap "Allow" (Precise).\n\nLE Sales आपके काम के दिन में आपकी लोकेशन Lalit Enterprises को भेजता है — ऐप बंद या उपयोग में न होने पर भी — End day दबाने तक (रात 9 बजे अपने-आप बंद)। "Allow" दबाएँ।');
        await N.requestForegroundLocation();
        if (!await waitFor(async () => (await N.status()).fine, 40000)) { LE.toast('Location permission not given'); s = await N.status(); if (!s.fine) { await N.openAppSettings(); return; } }
      }
      s = await N.status();
      if (!s.notifications && s.sdk >= 33) { await N.requestNotifications(); await waitFor(async () => (await N.status()).notifications, 15000); }
      st = await E.start();
      LE.toast('Day started · location sharing on');
      paintPill(); syncWebState();
      s = await N.status();
      if (!s.background) await explainBackground();
      else if (!s.batteryUnrestricted) { alert('One more step: allow LE Sales to run without battery restriction, so sharing does not stop.\nबैटरी पाबंदी हटाने के लिए अगली स्क्रीन पर "Allow" दबाएँ।'); await N.requestBatteryUnrestricted(); }
      setTimeout(() => sheet(), 600);
    } else {
      alert('LE Sales will ask for your location. Choose "Allow While Using App", and later "Change to Always Allow" when iPhone asks.\nलोकेशन की अनुमति दें — बाद में "Always Allow" चुनें।');
      await E.start(); LE.toast('Day started · location sharing on'); close();
    }
    await refresh();
  }

  // v3 attendance: check-in starts the day's tracking, check-out ends it (same as Start day / End day)
  Object.assign(window.LE_NATIVE, {
    isActive: () => !!st.active,
    startDay: async () => { try { if (!st.active && !afterHours()) await startDay(); } catch (e) { LE.toast(LE.errMsg(e)); } },
    endDay: async reason => { try { const s = await E.status().catch(() => ({})); if (s.active) { await E.stop(reason || 'check-out'); LE.toast('Day ended · location sharing off'); } await refresh(); } catch (e) { LE.toast(LE.errMsg(e)); } }
  });

  _on(what => { if (what === 'auth') refresh(); });
})();
