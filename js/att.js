/* LE Sales v3 — attendance & payroll: data, day rules, selfie + GPS check-in/out, employee screens.
 * Firestore: attendance/{uid}_{date}, attendancePhotos/{uid}_{date}_{in|out}, leaves/{id}, settings/attendance,
 *            salary/{uid} (admin only), payroll/{uid}_{YYYY-MM} (admin; employee reads own finalized). */
const ATT = (() => {
const {esc, money, today, nice, niceLong, time} = LE;
const {V, st, render, modal, closeModal, mh, kpi, listCard, $, $$} = UI;
const S = DB.S;
const DEF = {start: '10:00', grace: 15, halfHours: 4, weekOff: [0], holidays: [], basis: 'calendar', latePerHalf: 0};
const A = {mockToday: new Map(), mockDays: new Map(), settings: {...DEF}, mine: new Map(), myMonths: new Set(), leaves: new Map(), today: new Map(), month: new Map(), monthKey: '',
  salary: new Map(), payroll: new Map(), payMonth: '', slips: null, photos: new Map(), loaded: false};
let unsubs = [], monthUnsub = null, payUnsub = null, myUnsubs = new Map();
const fs = () => firebase.firestore();
const staffRole = () => S.profile && S.profile.active && ['sales', 'manager'].includes(S.profile.role);
const redraw = () => { if (!S.user || !S.profile) return; if ($('#modal')) { A.dirty = true; return; } render(); };
const warn = e => console.warn('attendance', e && e.code, e && e.message);

/* ---------- day helpers ---------- */
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const daysOf = m => { const n = new Date(+m.slice(0, 4), +m.slice(5, 7), 0).getDate(); return Array.from({length: n}, (_, i) => `${m}-${String(i + 1).padStart(2, '0')}`); };
const dow = ds => new Date(ds + 'T12:00:00').getDay();
const holiday = ds => (A.settings.holidays || []).find(h => h.date === ds);
const isWO = ds => (A.settings.weekOff || []).includes(dow(ds));
const mins = hhmm => { const [h, m] = String(hhmm || '10:00').split(':').map(Number); return h * 60 + (m || 0); };
const lateMin = r => { if (!r || !r.inTs) return 0; const d = new Date(r.inTs), m = d.getHours() * 60 + d.getMinutes(); const x = m - mins(A.settings.start); return x > (+A.settings.grace || 0) ? x : 0; };
const hoursOf = r => r && r.inTs && r.outTs ? Math.max(0, (r.outTs - r.inTs) / 3600000) : 0;
const fmtH = h => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`; };
const monthsBack = n => Array.from({length: n}, (_, i) => LE.month(LE.addDays(LE.month() + '-15', -30.5 * i | 0)));
const joinOf = uid => { const s = A.salary.get(uid); if (s && s.joinDate) return s.joinDate; const u = uid === (S.user && S.user.uid) ? S.profile : S.users.get(uid); return u && u.createdAt ? LE.dstr(u.createdAt) : '2000-01-01'; };
const leaveOn = (uid, ds) => [...A.leaves.values()].find(l => l.uid === uid && l.status === 'approved' && l.from <= ds && l.to >= ds);
const STAT = {P: ['Present', 'p'], H: ['Half-day', 'h'], A: ['Absent', 'a'], L: ['Leave', 'l'], LWP: ['Unpaid leave', 'a'], WO: ['Week-off', 'wo'], HO: ['Holiday', 'ho'], IN: ['Checked in', 'p'], PEND: ['Not checked in', 'pend'], NJ: ['Not joined', 'nj'], '': ['', 'fut']};
/* status of one person-day. rec = attendance doc (or undefined) */
function dayStatus(uid, ds, rec, join) {
  if (rec && rec.ovStatus) return rec.ovStatus;
  const t = today(), off = holiday(ds) ? 'HO' : isWO(ds) ? 'WO' : '';
  if (rec && rec.inTs) {
    if (rec.outTs) return hoursOf(rec) >= (+A.settings.halfHours || 4) ? 'P' : 'H';
    return ds === t ? 'IN' : 'H';                       // no check-out = half-day
  }
  const lv = leaveOn(uid, ds);
  if (lv) return lv.paid === false || lv.type === 'LWP' ? 'LWP' : 'L';
  if (off) return off;
  if (ds > t) return '';
  if (ds < (join || joinOf(uid))) return 'NJ';
  return ds === t ? 'PEND' : 'A';
}
/* month summary + pay maths. recs: Map date -> attendance doc for this uid */
function summarize(uid, m, recs, monthly = 0) {
  const sset = A.settings, basis = sset.basis || 'calendar', join = joinOf(uid), days = daysOf(m);
  const c = {P: 0, H: 0, A: 0, L: 0, LWP: 0, WO: 0, HO: 0, IN: 0, PEND: 0, NJ: 0, '': 0}; let late = 0, offWorked = 0, paid = 0, workDays = 0;
  const unit = {P: 1, IN: 1, H: .5, L: 1, WO: basis === 'calendar' ? 1 : 0, HO: basis === 'calendar' ? 1 : 0};
  const perDayRows = days.map(ds => {
    const r = recs.get(ds), code = dayStatus(uid, ds, r, join), off = !!(holiday(ds) || isWO(ds));
    c[code] = (c[code] || 0) + 1;
    if (!off) workDays++;
    if (r && r.inTs && !r.ovStatus && lateMin(r)) late++;
    if (off && r && r.inTs) offWorked++;
    const u = (basis === 'working' && off && (code === 'P' || code === 'H' || code === 'IN')) ? 0 : (unit[code] || 0);
    paid += u;
    return {ds, code, r};
  });
  const lateCut = +sset.latePerHalf > 0 ? Math.floor(late / +sset.latePerHalf) * 0.5 : 0;
  const divisor = basis === 'calendar' ? days.length : workDays;
  const paidDays = Math.max(0, Math.min(divisor, paid - lateCut));
  const perDay = divisor ? monthly / divisor : 0;
  return {rows: perDayRows, c, late, lateCut, offWorked, paidDays, perDay, earned: Math.round(perDay * paidDays), daysInMonth: days.length, workDays, basis,
    present: c.P + c.IN, half: c.H, paidLeave: c.L, unpaidLeave: c.LWP, absent: c.A, weekOffs: c.WO, holidays: c.HO, notJoined: c.NJ};
}
const byDate = (uid, list) => new Map(list.filter(r => r.uid === uid).map(r => [r.date, r]));

/* ---------- data ---------- */
DB.on(what => { if (what === 'auth') boot(); });
function stopAll() { unsubs.forEach(u => u()); unsubs = []; monthUnsub && monthUnsub(); payUnsub && payUnsub(); myUnsubs.forEach(u => u()); myUnsubs = new Map(); monthUnsub = payUnsub = null; }
function boot() {
  stopAll();
  Object.assign(A, {mockToday: new Map(), mockDays: new Map(), settings: {...DEF}, mine: new Map(), myMonths: new Set(), leaves: new Map(), today: new Map(), month: new Map(), monthKey: '', salary: new Map(), payroll: new Map(), payMonth: '', slips: null, photos: new Map(), loaded: false});
  if (!S.user || !S.profile || !S.profile.active) return;
  const db = fs(), uid = S.user.uid;
  unsubs.push(db.collection('settings').doc('attendance').onSnapshot(s => { A.settings = {...DEF, ...(s.exists ? s.data() : {})}; redraw(); }, warn));
  if (staffRole()) { watchMine(LE.month()); unsubs.push(db.collection('leaves').where('uid', '==', uid).onSnapshot(s => { if (!DB.isMgr()) A.leaves = new Map(s.docs.map(d => [d.id, {id: d.id, ...d.data()}])); else s.docs.forEach(d => A.leaves.set(d.id, {id: d.id, ...d.data()})); redraw(); }, warn)); }
  if (DB.isMgr()) {
    unsubs.push(db.collection('attendance').where('date', '==', today()).onSnapshot(s => { A.today = new Map(s.docs.map(d => [d.data().uid, d.data()])); A.loaded = true; redraw(); }, warn));
    unsubs.push(db.collection('locations').where('date', '==', today()).where('mock', '==', true).onSnapshot(s => { A.mockToday = new Map(); s.docs.forEach(d => { const x = d.data(), a = A.mockToday.get(x.ownerUid) || []; a.push(x); A.mockToday.set(x.ownerUid, a.sort((p, q) => p.ts - q.ts)); }); redraw(); }, warn));
    unsubs.push(db.collection('leaves').where('to', '>=', LE.month(LE.addDays(LE.month() + '-01', -40)) + '-01').onSnapshot(s => { s.docs.forEach(d => A.leaves.set(d.id, {id: d.id, ...d.data()})); redraw(); }, warn));
  }
  if (DB.isAdmin()) unsubs.push(db.collection('salary').onSnapshot(s => { A.salary = new Map(s.docs.map(d => [d.id, d.data()])); redraw(); }, warn));
}
function watchMine(m) {
  if (!staffRole() || myUnsubs.has(m)) return;
  myUnsubs.set(m, fs().collection('attendance').where('uid', '==', S.user.uid).where('month', '==', m).onSnapshot(s => {
    s.docs.forEach(d => A.mine.set(d.data().date, d.data())); A.myMonths.add(m); redraw(); }, warn));
}
function watchMonth(m) {
  if (A.monthKey === m) return; A.monthKey = m; A.month = new Map(); monthUnsub && monthUnsub();
  monthUnsub = fs().collection('attendance').where('month', '==', m).onSnapshot(s => { A.month = new Map(s.docs.map(d => [d.id, d.data()])); A.monthLoaded = m; redraw(); }, warn);
}
function watchPayroll(m) {
  if (A.payMonth === m) return; A.payMonth = m; A.payroll = new Map(); payUnsub && payUnsub();
  payUnsub = fs().collection('payroll').where('month', '==', m).onSnapshot(s => { A.payroll = new Map(s.docs.map(d => [d.data().uid, d.data()])); redraw(); }, warn);
}
async function photo(id) {
  if (A.photos.has(id)) return A.photos.get(id);
  const p = fs().collection('attendancePhotos').doc(id).get().then(s => s.exists ? s.data().img : '').catch(e => { warn(e); A.photos.delete(id); return ''; });
  A.photos.set(id, p); return p;
}
const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(Object.assign(new Error(msg), {code: 'timeout'})), ms))]);

/* ---------- selfie + GPS capture ---------- */
function getGPS() {
  return new Promise(ok => {
    if (!navigator.geolocation) return ok({err: 'GPS not available on this device'});
    navigator.geolocation.getCurrentPosition(p => ok({lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy), at: p.timestamp || Date.now()}),
      e => ok({err: e.code === 1 ? 'Location permission denied' : e.message || 'Location not found'}), {enableHighAccuracy: true, timeout: 25000, maximumAge: 15000});
  });
}
async function geocode(lat, lng) {
  try {
    const c = new AbortController(); setTimeout(() => c.abort(), 5000);
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&accept-language=en&lat=${lat}&lon=${lng}`, {signal: c.signal});
    const j = await r.json(); const a = j.address || {};
    return [a.road || a.neighbourhood || a.suburb, a.suburb && a.road ? a.suburb : '', a.city || a.town || a.village || a.county].filter(Boolean).join(', ').slice(0, 200) || (j.display_name || '').slice(0, 200);
  } catch { return ''; }
}
function compress(src, w0, h0, stamp) {      // -> JPEG data URL, 320px wide (3:4), ~20-35 KB
  const W = 320, H = 427, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  const r = Math.max(W / w0, H / h0), sw = W / r, sh = H / r; g.drawImage(src, (w0 - sw) / 2, (h0 - sh) / 2, sw, sh, 0, 0, W, H);
  g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, H - 40, W, 40); g.fillStyle = '#ffc53d'; g.font = 'bold 12px sans-serif'; g.fillText(stamp[0], 8, H - 24);
  g.fillStyle = '#fff'; g.font = '11px sans-serif'; g.fillText(stamp[1], 8, H - 9);
  let q = .72, out = c.toDataURL('image/jpeg', q); while (out.length > 48000 && q > .3) { q -= .08; out = c.toDataURL('image/jpeg', q); }
  return out;
}
const MOCK_MSG = 'Fake GPS detected — turn off mock location app';
async function nativeFix() {
  try {
    const f = await window.LE_NATIVE.fix({timeoutMs: 25000, maxAgeMs: 10000});
    return {lat: f.lat, lng: f.lng, acc: Math.round(f.accuracy), at: f.time || Date.now(), mock: !!f.mock, apps: f.mockAppsInstalled || [], active: f.mockAppsActive || [], legacy: !!f.legacyMockSetting};
  } catch (e) {
    const ms = await window.LE_NATIVE.mockStatus().catch(() => ({}));
    return {err: (e && e.message) || 'Location not found', apps: ms.mockAppsInstalled || [], active: ms.mockAppsActive || [], legacy: !!ms.legacyMockSetting};
  }
}
/* why this fix / phone must be refused (string) or '' */
function mockReason(g) {
  if (!g) return '';
  const apps = g.apps || g.mockAppsInstalled || [], act = g.active || g.mockAppsActive || [];
  if (g.mock) return act.length ? `Mock location from: ${act.join(', ')}` : 'Your phone reported this location as a mock (fake) location.';
  if (act.length) return `Mock location app is ON: ${act.join(', ')}`;
  if (apps.length) return `Uninstall this fake-GPS app to mark attendance: ${apps.join(', ')}`;
  if (g.legacy || g.legacyMockSetting) return '“Allow mock locations” is ON in Developer options.';
  return '';
}
function block(ctx, why) {
  ctx.blocked = why || true; const s = $('#snap'), c = $('#confirm'); if (s) s.disabled = true; if (c) c.disabled = true; if (ctx.stopCam) ctx.stopCam(); const cm = $('#cammsg'); if (cm) { cm.hidden = false; cm.innerHTML = `${icon('alert')}<b>Attendance blocked</b><small>Fake GPS / mock location found on this phone</small>`; }
  if (ctx.logged) return; ctx.logged = true;
  const g = ctx.gps || {}; if (g.lat == null || !S.user) return;
  // leave a trace for the owner: a FAKE GPS point on the live map, route and attendance board
  const now = Date.now(), d = {ownerUid: S.user.uid, ownerName: S.profile.name, lat: g.lat, lng: g.lng, accuracy: g.acc || 0, ts: now, date: LE.dstr(now), source: 'android',
    reason: ctx.kind === 'in' ? 'checkin-blocked' : 'checkout-blocked', mock: true, mockApp: String(why || '').slice(0, 200), appVersion: 'android-' + (window.LE_NATIVE.appVersion || ''), updatedAt: now};
  const db = fs(); db.collection('locations').doc(S.user.uid + '_' + now.toString(36)).set(d).catch(e => console.warn('mock log', e.code));
  db.collection('lastLocation').doc(S.user.uid).set(d).catch(e => console.warn('mock log', e.code));
}
const isNative = () => !!(window.LE_NATIVE && window.LE_NATIVE.platform);
async function capture(kind) {
  if (isNative() && window.LE_NATIVE.ready) await window.LE_NATIVE.ready;
  const nat = isNative() && !!window.LE_NATIVE.mockCheck;        // v1.1 Android app: native fix + fake-GPS check
  const cur = A.mine.get(today());
  if (kind === 'in' && cur) return LE.toast('Already marked for today');
  if (kind === 'out' && (!cur || cur.status !== 'in')) return LE.toast('Check in first');
  if (!navigator.onLine) return LE.toast('No internet. Check-in needs internet so the time and location are verified.');
  const title = kind === 'in' ? 'Check in' : 'Check out';
  const m = modal(`${mh(title + ' · ' + time(Date.now()))}
    <div class="cam" id="cam"><video id="camv" playsinline autoplay muted></video><img id="camimg" alt="Your photo" hidden><div class="cam-msg" id="cammsg">Starting camera…</div></div>
    <input type="file" id="camfile" accept="image/*" capture="user" hidden>
    <div class="gps" id="agps">${icon('pin')}<span>Getting your location…</span></div>
    <p class="note" style="margin-top:8px">Take a live selfie at your work location. Photo, time and GPS go to Lalit Enterprises for attendance.</p>
    <div class="modal-f" id="camacts"><button type="button" class="btn ghost" data-close>Cancel</button><button type="button" class="btn pri" id="snap" disabled>${icon('camera')}Capture</button></div>`, 'att-modal');
  const ctx = {kind, nat, gps: null, img: null, stream: null, flags: [], src: isNative() ? (window.LE_NATIVE.platform || 'app') : 'web', addr: ''};
  const stopCam = () => { if (ctx.stream) ctx.stream.getTracks().forEach(t => t.stop()); ctx.stream = null; };
  ctx.stopCam = stopCam;
  const obs = new MutationObserver(() => { if (!document.body.contains(m)) { stopCam(); obs.disconnect(); } }); obs.observe(document.body, {childList: true});
  const v = $('#camv'), img = $('#camimg'), msg = $('#cammsg'), snap = $('#snap'), file = $('#camfile');
  const stampTxt = () => [`LE ${kind === 'in' ? 'CHECK-IN' : 'CHECK-OUT'} · ${S.profile.name}`.slice(0, 44), `${new Date().toLocaleString('en-IN', {day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit'})}${ctx.gps && ctx.gps.lat != null ? ` · ${ctx.gps.lat.toFixed(5)}, ${ctx.gps.lng.toFixed(5)} ±${ctx.gps.acc}m` : ' · no GPS'}`];
  const paintGps = () => { const b = $('#agps'); if (!b) return; const g = ctx.gps;
    if (!g) { b.className = 'gps'; b.innerHTML = `${icon('pin')}<span>Getting your location…</span>`; return; }
    if (ctx.blocked) { b.className = 'gps mockbad'; b.innerHTML = `${icon('alert')}<span><b>${MOCK_MSG}</b>${ctx.blocked !== true ? '<br>' + esc(ctx.blocked) : ''}<br><small>नकली GPS / mock location ऐप बंद या अनइंस्टॉल करें, फिर दोबारा कोशिश करें।</small></span>`; return; }
    if (g.err) { b.className = 'gps bad'; b.innerHTML = `${icon('pin')}<span>${esc(g.err)}. Turn on GPS and allow location. <a href="#" id="regps">Try again</a></span>`; }
    else { b.className = 'gps ' + (g.acc > 200 ? 'bad' : 'ok'); b.innerHTML = `${icon(g.acc > 200 ? 'alert' : 'check')}<span>Location ±${g.acc} m${g.acc > 200 ? ' (weak — move to open sky if you can)' : ''} · <a href="${LE.map(g.lat, g.lng)}" target="_blank" rel="noopener">map</a>${ctx.addr ? ' · ' + esc(ctx.addr) : ''} · <a href="#" id="regps">refresh</a></span>`; }
    const r = $('#regps'); r && (r.onclick = e => { e.preventDefault(); ctx.gps = null; paintGps(); locate(); }); };
  const locate = async () => {
    ctx.gps = nat ? await nativeFix() : await getGPS();
    const why = mockReason(ctx.gps);
    if (why) { block(ctx, why); paintGps(); return; }
    paintGps(); if (ctx.gps.lat != null) { ctx.addr = await geocode(ctx.gps.lat, ctx.gps.lng); paintGps(); } };
  locate();
  const useFile = () => { msg.hidden = false; msg.innerHTML = `<button type="button" class="btn pri lg" id="openfile">${icon('camera')}Open camera</button><small>Take a selfie now (gallery photos are not accepted)</small>`; $('#openfile').onclick = () => file.click(); snap.hidden = true; };
  file.onchange = () => { const f = file.files[0]; if (!f) return; const age = Date.now() - (f.lastModified || Date.now()); if (age > 120000) ctx.flags.push('oldPhoto'); ctx.flags.push('camApp');
    const u = URL.createObjectURL(f), im = new Image(); im.onload = () => { ctx.raw = im; ctx.rawW = im.naturalWidth; ctx.rawH = im.naturalHeight; shown(); URL.revokeObjectURL(u); }; im.src = u; };
  const shown = () => { ctx.img = compress(ctx.raw, ctx.rawW, ctx.rawH, stampTxt()); img.src = ctx.img; img.hidden = false; v.hidden = true; msg.hidden = true; stopCam();
    $('#camacts').innerHTML = `<button type="button" class="btn ghost" id="retake">Retake</button><button type="button" class="btn pri" id="confirm">${icon('check')}Confirm ${kind === 'in' ? 'check-in' : 'check-out'}</button>`;
    $('#retake').onclick = () => { closeModal(); capture(kind); }; $('#confirm').onclick = () => submit(ctx); };
  const camDenied = () => { msg.hidden = false; snap.hidden = true; msg.innerHTML = `${icon('camera')}<b>Camera permission is off</b><small>Allow “Camera” for LE Sales, then try again. कैमरा की अनुमति दें।</small><div style="display:flex;gap:8px"><button type="button" class="btn" id="camset">Open settings</button><button type="button" class="btn pri" id="camretry">Try again</button></div>`;
    $('#camset').onclick = () => window.LE_NATIVE.openSettings && window.LE_NATIVE.openSettings(); $('#camretry').onclick = () => { closeModal(); capture(kind); }; };
  ctx.camDenied = camDenied;
  if ((isNative() && !window.LE_NATIVE.liveCamera) || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { if (nat) camDenied(); else useFile(); }
  else navigator.mediaDevices.getUserMedia({video: {facingMode: 'user', width: {ideal: 720}, height: {ideal: 960}}, audio: false}).then(s => {
    if (!document.body.contains(m)) return s.getTracks().forEach(t => t.stop());
    if (ctx.blocked) { s.getTracks().forEach(t => t.stop()); return; } ctx.stream = s; v.srcObject = s; msg.hidden = true; snap.disabled = false;
    snap.onclick = () => { if (!v.videoWidth) return; const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0); ctx.raw = c; ctx.rawW = c.width; ctx.rawH = c.height; shown(); };
  }).catch(e => { console.warn('camera', e && e.name); if (!document.body.contains(m)) return; if (nat) camDenied(); else useFile(); });
}
async function submit(ctx) {
  const b = $('#confirm'), g = ctx.gps;
  if (ctx.blocked) { LE.toast(MOCK_MSG, 4000); return; }
  if (!g) { LE.toast('Still getting your location… wait a few seconds'); return; }
  if (ctx.nat) {                                                  // re-check right before saving
    const ms = await window.LE_NATIVE.mockStatus().catch(() => null), why = ms && mockReason(ms);
    if (why) { block(ctx, why); const box = $('#agps'); box && (box.className = 'gps mockbad', box.innerHTML = `${icon('alert')}<span><b>${MOCK_MSG}</b><br>${esc(why === true ? '' : why)}</span>`); return; }
  }
  if (g.err && !confirm('Location not captured. Save without GPS? It will be flagged for the owner.')) return;
  if (ctx.raw) ctx.img = compress(ctx.raw, ctx.rawW, ctx.rawH, [`LE ${ctx.kind === 'in' ? 'CHECK-IN' : 'CHECK-OUT'} · ${S.profile.name}`.slice(0, 44), `${new Date().toLocaleString('en-IN', {day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit'})}${g.lat != null ? ` · ${g.lat.toFixed(5)}, ${g.lng.toFixed(5)} ±${g.acc}m` : ' · no GPS'}`]);
  b.disabled = true; b.textContent = 'Saving…';
  const uid = S.user.uid, d = today(), id = `${uid}_${d}`, now = Date.now(), db = fs(), k = ctx.kind, P = k === 'in' ? 'in' : 'out';
  const flags = [...new Set([...ctx.flags, ...(g.err ? ['noGps'] : []), ...(g.acc > 200 ? ['poorGps'] : []), ...(g.at && now - g.at > 180000 ? ['staleGps'] : [])])];
  const loc = g.lat != null ? {[P + 'Lat']: +g.lat.toFixed(6), [P + 'Lng']: +g.lng.toFixed(6), [P + 'Acc']: g.acc} : {};
  if (ctx.addr) loc[P + 'Addr'] = ctx.addr;
  const batch = db.batch();
  batch.set(db.collection('attendancePhotos').doc(`${id}_${k}`), {uid, date: d, kind: k, img: ctx.img, ts: now});
  const att = db.collection('attendance').doc(id), cur = A.mine.get(d);
  if (k === 'in') batch.set(att, {uid, name: S.profile.name, date: d, month: d.slice(0, 7), status: 'in', inAt: firebase.firestore.FieldValue.serverTimestamp(), inTs: now, ...loc, inFlags: flags, inSrc: ctx.src, createdAt: now, updatedAt: now});
  else batch.update(att, {status: 'out', outAt: firebase.firestore.FieldValue.serverTimestamp(), outTs: now, ...loc, outFlags: flags, outSrc: ctx.src, hours: Math.round((now - cur.inTs) / 36000) / 100, updatedAt: now});
  try {
    await withTimeout(batch.commit(), 25000, 'Slow network — try again in a moment.');
    A.photos.set(`${id}_${k}`, Promise.resolve(ctx.img));
    closeModal();
    const lm = k === 'in' ? lateMin({inTs: now}) : 0;
    LE.toast(k === 'in' ? `Checked in at ${time(now)}${lm ? ` · late by ${lm} min` : ' · on time'}` : `Checked out at ${time(now)} · ${fmtH((now - cur.inTs) / 3600000)}`, 3500);
    // Android/iOS app: check-in starts the day's location sharing, check-out ends it
    if (window.LE_NATIVE && S.profile.role === 'sales') { if (k === 'in' && LE_NATIVE.startDay) setTimeout(() => LE_NATIVE.startDay(), 700); if (k === 'out' && LE_NATIVE.endDay) setTimeout(() => LE_NATIVE.endDay('check-out'), 700); }
  } catch (e) {
    console.warn('attendance save', e); b.disabled = false; b.textContent = 'Try again';
    const why = e.code === 'permission-denied' ? 'Not allowed. Make sure your phone date & time are set to automatic, and you have not already marked this today.' : e.code === 'timeout' ? e.message : LE.errMsg(e);
    const box = $('#agps'); box && box.insertAdjacentHTML('afterend', `<div class="err" style="margin-top:8px">${esc(why)}</div>`);
  }
}

/* ---------- employee: Today card ---------- */
function todayCard() {
  if (!staffRole()) return '';
  const d = today(), r = A.mine.get(d), code = dayStatus(S.user.uid, d, r), now = new Date(), nowM = now.getHours() * 60 + now.getMinutes();
  const loaded = A.myMonths.has(LE.month());
  if (!loaded) return `<div class="attc"><div class="attc-b"><b>Attendance</b><span class="note" style="margin:0">Loading…</span></div></div>`;
  if (r && r.ovStatus && !r.inTs) return `<div class="attc"><span class="attc-i st-${STAT[r.ovStatus][1]}">${icon('calcheck')}</span><div class="attc-b"><b>Today: ${STAT[r.ovStatus][0]}</b><span>Marked by ${esc(r.ovByName || 'admin')} · ${esc(r.ovReason || '')}</span></div></div>`;
  if (!r) {
    const off = holiday(d) ? `Holiday · ${esc(holiday(d).name)}` : isWO(d) ? 'Week-off today' : '', lv = leaveOn(S.user.uid, d);
    if (lv) return `<div class="attc"><span class="attc-i st-l">${icon('calcheck')}</span><div class="attc-b"><b>On leave today</b><span>${esc(lv.reason || '')}</span></div></div>`;
    const late = !off && nowM > mins(A.settings.start) + (+A.settings.grace || 0);
    return `<div class="attc ${late ? 'warn' : ''}"><span class="attc-i">${icon(late ? 'alert' : 'fp')}</span><div class="attc-b"><b>${off ? off : late ? 'You have not checked in yet' : 'Start your day'}</b>
      <span>${off ? 'Working today? Check in.' : `Office time ${A.settings.start} · ${late ? 'you will be marked late' : 'selfie + location'}`}</span></div><button class="btn pri" data-att="in">${icon('camera')}Check in</button></div>`;
  }
  if (r.status === 'in') {
    const lm = lateMin(r), h = (Date.now() - r.inTs) / 3600000;
    return `<div class="attc on"><span class="attc-i st-p">${icon('check')}</span><div class="attc-b"><b>Checked in ${time(r.inTs)}${lm ? ` <span class="tag a">Late ${lm}m</span>` : ' <span class="tag on">On time</span>'}</b>
      <span>${fmtH(h)} so far${r.inAddr ? ' · ' + esc(r.inAddr) : ''}</span></div><button class="btn" data-att="out">${icon('camera')}Check out</button></div>`;
  }
  return `<div class="attc done"><span class="attc-i st-${STAT[code][1]}">${icon('calcheck')}</span><div class="attc-b"><b>Day complete · ${STAT[code][0]}</b><span>${time(r.inTs)} → ${time(r.outTs)} · ${fmtH(hoursOf(r))}${lateMin(r) ? ` · late ${lateMin(r)}m` : ''}</span></div><a class="btn sm" href="#/myatt">My attendance</a></div>`;
}

/* ---------- calendars ---------- */
const legend = c => `<div class="att-legend">${[['P', c.P + (c.IN || 0)], ['H', c.H], ['A', c.A], ['L', c.L + (c.LWP || 0)], ['HO', c.HO], ['WO', c.WO]].map(([k, n]) => `<span class="st-${STAT[k][1]}"><i></i>${STAT[k][0]} <b>${n || 0}</b></span>`).join('')}</div>`;
function calendar(uid, m, recs, clickable) {
  const sm = summarize(uid, m, recs), first = dow(m + '-01');
  const cells = Array(first).fill('<div class="d out"></div>').concat(sm.rows.map(({ds, code, r}) => {
    const lm = r && !r.ovStatus ? lateMin(r) : 0, h = holiday(ds);
    return `<div class="d st-${STAT[code][1]} ${ds === today() ? 'is-today' : ''}" ${clickable && (r || code !== '') ? `data-attday="${uid}|${ds}"` : ''} title="${esc(STAT[code][0] + (h ? ' · ' + h.name : ''))}"><span class="n">${+ds.slice(8)}</span><span class="c">${code && code !== 'NJ' ? code.replace('PEND', '–').replace('IN', 'P') : ''}</span>${lm ? '<i class="late"></i>' : ''}${r && r.ovStatus ? '<i class="ov"></i>' : ''}</div>`;
  }));
  return {html: `<div class="cal att-cal">${DOW.map(x => `<div class="dow">${x}</div>`).join('')}${cells.join('')}</div>`, sm};
}
const mocksOf = (uid, ds) => ds === today() ? (A.mockToday.get(uid) || []) : (A.mockDays.get(uid + '|' + ds) || []);
const mockBox = pts => pts.length ? `<div class="err" style="margin-top:10px"><b>⚠ Fake GPS detected ${pts.length} time(s)</b> — ${pts.slice(0, 6).map(p => `${time(p.ts)} ${p.reason === 'checkin-blocked' ? '(check-in refused)' : p.reason === 'checkout-blocked' ? '(check-out refused)' : '(tracking)'}${p.mockApp ? ' · ' + esc(p.mockApp) : ''}`).join('; ')}${pts.length > 6 ? '…' : ''}</div>` : '';
function dayModal(uid, ds) {
  const isMe = uid === S.user.uid, r = isMe ? A.mine.get(ds) : (A.month.get(`${uid}_${ds}`) || (ds === today() ? A.today.get(uid) : null));
  const u = isMe ? S.profile : (S.users.get(uid) || {name: r && r.name || ''}), code = dayStatus(uid, ds, r), lm = r && r.inTs ? lateMin(r) : 0;
  const side = k => { const ts = r && r[k + 'Ts']; if (!ts) return `<div class="att-side"><div class="ph empty-ph">${icon('camera')}</div><b>${k === 'in' ? 'Check-in' : 'Check-out'}</b><span class="note" style="margin:0">${k === 'out' && r && r.inTs ? (ds === today() ? 'Not yet' : 'Missed (counted as half-day)') : '—'}</span></div>`;
    const la = r[k + 'Lat'], fl = r[k + 'Flags'] || [];
    return `<div class="att-side"><div class="ph" data-ph="${uid}_${ds}_${k}"><span class="note">Loading photo…</span></div><b>${k === 'in' ? 'Check-in' : 'Check-out'} ${time(ts)}</b>
      <span class="note" style="margin:0">${la != null ? `<a href="${LE.map(la, r[k + 'Lng'])}" target="_blank" rel="noopener">📍 map ±${r[k + 'Acc']}m</a>` : '<span style="color:var(--red)">no GPS</span>'}${r[k + 'Addr'] ? ' · ' + esc(r[k + 'Addr']) : ''}</span>${flagTags(fl)}</div>`; };
  const ovForm = DB.isAdmin() && !isMe ? `<form id="ovf" class="ovf"><h3 style="margin:14px 0 6px">Correct this day</h3><div class="row2"><label class="f">Mark as<select name="st">${['P', 'H', 'A', 'L', 'LWP', 'WO', 'HO'].map(k => `<option value="${k}" ${(r && r.ovStatus || code) === k ? 'selected' : ''}>${STAT[k][0]}</option>`).join('')}</select></label>
      <label class="f">Reason (required)<input name="why" required maxlength="300" placeholder="e.g. Field visit to Hazaribagh, approved"></label></div><div class="modal-f"><button type="button" class="btn ghost" data-close>Close</button><button class="btn pri">Save correction</button></div></form>` : `<div class="modal-f"><button class="btn" data-close>Close</button></div>`;
  modal(`${mh(esc(u.name || '') + ' · ' + niceLong(ds))}
    <div class="att-head"><span class="tag st-${STAT[code][1]}">${STAT[code][0]}</span>${r && r.inTs && r.outTs ? `<span class="note" style="margin:0">${fmtH(hoursOf(r))} worked</span>` : ''}${lm ? `<span class="tag a">Late ${lm} min</span>` : ''}${holiday(ds) ? `<span class="note" style="margin:0">Holiday: ${esc(holiday(ds).name)}</span>` : ''}</div>
    ${r && r.ovStatus ? `<div class="ok" style="margin-top:10px">Corrected to <b>${STAT[r.ovStatus][0]}</b> by ${esc(r.ovByName || 'admin')}${r.ovAt && r.ovAt.toDate ? ' on ' + r.ovAt.toDate().toLocaleString('en-IN', {day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit'}) : ''} — “${esc(r.ovReason)}”${r.ovFrom ? ` (was ${STAT[r.ovFrom] ? STAT[r.ovFrom][0] : r.ovFrom})` : ''}</div>` : ''}
    ${DB.isMgr() && !isMe ? mockBox(mocksOf(uid, ds)) : ''}<div class="att-sides">${side('in')}${side('out')}</div>${ovForm}`, 'att-modal');
  $$('[data-ph]').forEach(async el => { const src = await photo(el.dataset.ph); el.innerHTML = src ? `<img src="${src}" alt="Attendance selfie">` : '<span class="note">No photo</span>'; if (src) el.onclick = () => lightbox(src); });
  const f = $('#ovf');
  f && (f.onsubmit = async e => { e.preventDefault(); const st2 = f.st.value, why = f.why.value.trim(); if (!why) return; const btn = f.querySelector('.btn.pri'); btn.disabled = true;
    try { await override(uid, ds, st2, why, r, code); closeModal(); LE.toast('Attendance corrected'); } catch (er) { btn.disabled = false; LE.toast(LE.errMsg(er)); } });
}
function lightbox(src) { const d = document.createElement('div'); d.className = 'lightbox'; d.innerHTML = `<img src="${src}" alt="Attendance selfie"><span>Tap to close</span>`; d.onclick = () => d.remove(); document.body.appendChild(d); }
const flagTags = fl => fl && fl.length ? `<div class="flags">${fl.map(x => `<span class="tag a" title="${esc(FLAG[x] || x)}">${esc(FLAGS[x] || x)}</span>`).join('')}</div>` : '';
const FLAGS = {noGps: 'No GPS', poorGps: 'Weak GPS', staleGps: 'Old GPS fix', oldPhoto: 'Old photo', camApp: 'Phone camera'};
const FLAG = {noGps: 'Location was not captured', poorGps: 'GPS accuracy worse than 200 m', staleGps: 'GPS fix older than 3 minutes', oldPhoto: 'Photo file was older than 2 minutes — may not be live', camApp: 'Taken with the phone camera app (in-app camera unavailable)'};
async function override(uid, ds, code, why, r, from) {
  const db = fs(), ref = db.collection('attendance').doc(`${uid}_${ds}`), now = Date.now();
  const ov = {ovStatus: code, ovReason: why, ovBy: S.user.uid, ovByName: S.profile.name, ovAt: firebase.firestore.FieldValue.serverTimestamp(), ovFrom: from || '', updatedAt: now};
  if (r && (r.inTs || r.status)) return ref.update(ov);
  const u = S.users.get(uid) || {};
  return ref.set({uid, name: u.name || '', date: ds, month: ds.slice(0, 7), status: 'none', ...ov, createdAt: now});
}

/* ---------- employee: My attendance (+ leave) ---------- */
V.myatt = {title: 'My attendance', render() {
  if (!staffRole()) return '<div class="empty">Attendance is for employees. Use Attendance in the menu.</div>';
  const m = st.q.mym || LE.month(); watchMine(m);
  const recs = new Map([...A.mine].filter(([d]) => d.startsWith(m))), {html, sm} = calendar(S.user.uid, m, recs, true);
  const lv = [...A.leaves.values()].filter(l => l.uid === S.user.uid).sort((a, b) => b.from.localeCompare(a.from));
  return `<div class="page-h"><div><h1>My attendance</h1><p>${LE.monthName(m)} · office ${A.settings.start} (grace ${A.settings.grace} min)</p></div>
    <div class="toolbar"><select data-sel="mym" style="width:auto;min-height:38px;margin:0">${monthsBack(6).map(x => `<option value="${x}" ${x === m ? 'selected' : ''}>${LE.monthName(x)}</option>`).join('')}</select><button class="btn pri" data-att="leave">${icon('plus')}Request leave</button></div></div>
    ${todayCard()}
    <div class="kpis k4" style="margin:12px 0">${kpi('green', 'check', sm.present, 'Present')}${kpi('amber', 'clock', sm.half, 'Half-day')}${kpi('red', 'x', sm.absent, 'Absent')}${kpi('violet', 'cal', sm.paidLeave + sm.unpaidLeave, 'Leave')}</div>
    <div class="card">${A.myMonths.has(m) ? html : '<div class="empty">Loading…</div>'}${legend(sm.c)}<p class="note">Late marks: <b>${sm.late}</b>${+A.settings.latePerHalf ? ` · every ${A.settings.latePerHalf} late marks = ½ day cut` : ''}. Tap a day to see your check-in photo and location. No check-out = half-day.</p></div>
    <div class="card-h" style="margin:16px 2px 8px"><h3>My leave requests</h3><a class="sub" href="#/payslips">My payslips →</a></div>
    ${listCard(lv.map(leaveLi), 'No leave requests yet')}`;
}};
const LT = {CL: 'Casual leave', SL: 'Sick leave', LWP: 'Unpaid leave'};
function leaveLi(l, o = {}) {
  const acts = o.admin && l.status === 'pending' ? `<div class="a"><button class="btn sm pri" data-lv="approve" data-id="${l.id}">${icon('check')}Approve</button><button class="btn sm danger" data-lv="reject" data-id="${l.id}">Reject</button></div>`
    : !o.admin && l.status === 'pending' ? `<div class="a"><button class="btn sm" data-lv="withdraw" data-id="${l.id}">Withdraw</button></div>` : o.admin && l.status === 'approved' && l.to >= today() ? `<div class="a"><button class="btn sm" data-lv="cancel" data-id="${l.id}">Cancel leave</button></div>` : '';
  return `<div class="li"><span class="dot">${icon('cal')}</span><div class="b"><div class="t"><span>${o.admin ? esc(l.name) + ' · ' : ''}${nice(l.from)}${l.to !== l.from ? ' – ' + nice(l.to) : ''} · ${l.days} day${l.days === 1 ? '' : 's'}</span><span class="tag lv-${l.status}">${l.status}</span></div>
    <div class="m"><span>${LT[l.type] || l.type}${l.status === 'approved' ? (l.paid === false || l.type === 'LWP' ? ' · unpaid' : ' · paid') : ''}</span>${l.reason ? `<span>· ${esc(l.reason)}</span>` : ''}${l.decidedByName ? `<span>· by ${esc(l.decidedByName)}</span>` : ''}${l.decisionNote ? `<span>· “${esc(l.decisionNote)}”</span>` : ''}</div>${acts}</div></div>`;
}
function leaveForm() {
  const t = LE.addDays(today(), 1);
  modal(`<form id="lf">${mh('Request leave')}<div class="row2"><label class="f">From<input type="date" name="from" required value="${t}" min="${LE.addDays(today(), -7)}"></label><label class="f">To<input type="date" name="to" required value="${t}"></label></div>
    <label class="f">Type<select name="type"><option value="CL">Casual leave (paid)</option><option value="SL">Sick leave (paid)</option><option value="LWP">Unpaid leave</option></select></label>
    <label class="f">Reason<input name="reason" maxlength="300" required placeholder="e.g. Family function"></label><p class="note" id="lfn"></p>
    <div class="modal-f"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn pri">Send request</button></div></form>`);
  const f = $('#lf'), cnt = () => { let n = 0; for (let d = f.from.value; d && d <= f.to.value && n < 40; d = LE.addDays(d, 1)) if (!holiday(d) && !isWO(d)) n++; return n; };
  const upd = () => { $('#lfn').textContent = f.to.value < f.from.value ? '“To” must be on or after “From”.' : `${cnt()} working day(s). The owner will approve or reject.`; };
  f.from.onchange = () => { if (f.to.value < f.from.value) f.to.value = f.from.value; upd(); }; f.to.onchange = upd; upd();
  f.onsubmit = async e => { e.preventDefault(); const n = cnt(); if (f.to.value < f.from.value || !n) return LE.toast('Pick working days'); if (n > 31) return LE.toast('Max 31 days per request');
    const b = f.querySelector('.btn.pri'); b.disabled = true;
    try { await withTimeout(fs().collection('leaves').add({uid: S.user.uid, name: S.profile.name, from: f.from.value, to: f.to.value, days: n, type: f.type.value, reason: f.reason.value.trim(), status: 'pending', createdAt: Date.now(), updatedAt: Date.now()}), 20000, 'No internet — try again');
      closeModal(); LE.toast('Leave request sent'); } catch (er) { b.disabled = false; LE.toast(LE.errMsg(er)); } };
}
async function leaveAction(act, id) {
  const l = A.leaves.get(id); if (!l) return; const ref = fs().collection('leaves').doc(id), now = Date.now();
  try {
    if (act === 'withdraw') { if (!confirm('Withdraw this leave request?')) return; await ref.update({status: 'cancelled', updatedAt: now}); }
    else {
      const note = act === 'approve' ? '' : prompt(act === 'reject' ? 'Reason for rejecting (optional)' : 'Reason for cancelling this leave (optional)') ;
      if (note === null) return;
      let paid = l.type !== 'LWP';
      if (act === 'approve' && l.type !== 'LWP') paid = confirm(`Approve ${l.name}'s ${LT[l.type]} as PAID leave?\n\nOK = paid · Cancel = unpaid`);
      await ref.update({status: act === 'approve' ? 'approved' : act === 'reject' ? 'rejected' : 'cancelled', ...(act === 'approve' ? {paid} : {}), decidedBy: S.user.uid, decidedByName: S.profile.name, decidedAt: now, ...(note ? {decisionNote: note.slice(0, 300)} : {}), updatedAt: now});
    }
    LE.toast('Saved');
  } catch (e) { LE.toast(LE.errMsg(e)); }
}

/* ---------- payslips ---------- */
function words(n) {
  n = Math.round(n); if (!n) return 'Zero';
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'], b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = x => x < 20 ? a[x] : b[Math.floor(x / 10)] + (x % 10 ? ' ' + a[x % 10] : ''), three = x => (x >= 100 ? a[Math.floor(x / 100)] + ' Hundred' + (x % 100 ? ' ' : '') : '') + (x % 100 ? two(x % 100) : '');
  const parts = [[1e7, 'Crore'], [1e5, 'Lakh'], [1e3, 'Thousand']]; let s = '', neg = n < 0; n = Math.abs(n);
  parts.forEach(([v, w]) => { if (n >= v) { s += (s ? ' ' : '') + (v === 1e7 ? words(Math.floor(n / v)) : two(Math.floor(n / v))) + ' ' + w; n %= v; } });
  if (n) s += (s ? ' ' : '') + three(n); return (neg ? 'Minus ' : '') + s;
}
function payslipHTML(p) {
  const row = (l, v) => `<tr><td>${l}</td><td class="r">${v}</td></tr>`, dd = x => (+x || 0).toLocaleString('en-IN', {maximumFractionDigits: 2});
  return `<div class="payslip" id="payslip">${p.status !== 'finalized' ? '<div class="ps-draft">DRAFT</div>' : ''}
    <div class="ps-h"><div><div class="ps-co">LALIT ENTERPRISES</div><div class="ps-sub">Electrical distributor · Ranchi, Jharkhand · +91 70042 21338</div></div><div class="ps-t">PAYSLIP<br><b>${LE.monthName(p.month)}</b></div></div>
    <table class="ps-info"><tr><td>Employee</td><td><b>${esc(p.name)}</b></td><td>Designation</td><td>${esc(p.designation || '—')}</td></tr>
      <tr><td>Pay basis</td><td>${p.basis === 'working' ? 'Working days' : 'Calendar days'} (${p.basis === 'working' ? p.workDays : p.daysInMonth})</td><td>Monthly salary</td><td>${money(p.monthly)}</td></tr></table>
    <table class="ps-days"><tr><th>Present</th><th>Half-day</th><th>Paid leave</th><th>Week-off</th><th>Holiday</th><th>Unpaid leave</th><th>Absent</th><th>Late</th><th>Paid days</th></tr>
      <tr><td>${p.present}</td><td>${p.half}</td><td>${p.paidLeave}</td><td>${p.weekOffs}</td><td>${p.holidays}</td><td>${p.unpaidLeave}</td><td>${p.absent}</td><td>${p.late}${p.lateCut ? ` (−${p.lateCut})` : ''}</td><td><b>${dd(p.paidDays)}</b></td></tr></table>
    <div class="ps-cols"><table><tr><th>Earnings</th><th class="r">₹</th></tr>${row(`Salary for ${dd(p.paidDays)} day(s)`, money(p.earned))}${row('Incentive', money(p.incentive))}${row('Allowance', money(p.allowance))}<tr class="tot"><td>Gross</td><td class="r">${money(p.earned + p.incentive + p.allowance)}</td></tr></table>
      <table><tr><th>Deductions</th><th class="r">₹</th></tr>${row('Advance recovered', money(p.advance))}${row('Other deductions', money(p.deduction))}<tr><td>&nbsp;</td><td></td></tr><tr class="tot"><td>Total</td><td class="r">${money(p.advance + p.deduction)}</td></tr></table></div>
    <div class="ps-net"><span>Net pay</span><b>${money(p.net)}</b></div><div class="ps-words">Rupees ${words(p.net)} only</div>
    ${p.notes ? `<div class="ps-notes">Note: ${esc(p.notes)}</div>` : ''}
    <div class="ps-f"><span>${p.status === 'finalized' ? 'Finalized' + (p.finalizedAt ? ' ' + new Date(p.finalizedAt).toLocaleDateString('en-IN') : '') : 'Draft — not final'}</span><span>Computer-generated payslip · Lalit Enterprises, Ranchi</span></div></div>`;
}
function showPayslip(p) {
  modal(`${mh('Payslip · ' + esc(p.name) + ' · ' + LE.monthName(p.month))}${payslipHTML(p)}<div class="modal-f noprint"><button class="btn" data-close>Close</button><button class="btn pri" data-att="print">${icon('print')}Print / Save PDF</button></div>`, 'ps-modal');
}
V.payslips = {title: 'My payslips', render() {
  if (!staffRole()) return '<div class="empty">Payslips are for employees.</div>';
  if (!A.slips) { A.slips = []; fs().collection('payroll').where('uid', '==', S.user.uid).where('status', '==', 'finalized').get().then(s => { A.slips = s.docs.map(d => d.data()).sort((a, b) => b.month.localeCompare(a.month)); A.slipsLoaded = true; redraw(); }).catch(e => { warn(e); A.slipsLoaded = true; redraw(); }); }
  return `<div class="page-h"><div><h1>My payslips</h1><p>Finalized salary slips from Lalit Enterprises</p></div><a class="btn" href="#/myatt">${icon('calcheck')}My attendance</a></div>
    ${!A.slipsLoaded ? '<div class="empty">Loading…</div>' : listCard(A.slips.map(p => `<div class="li tap" data-slip="${p.month}"><span class="dot">${icon('wallet')}</span><div class="b"><div class="t"><span>${LE.monthName(p.month)}</span><span class="amt">${money(p.net)}</span></div><div class="m"><span>${p.paidDays} paid days</span><span>·</span><span>tap to view / print</span></div></div></div>`), 'No payslips yet. They appear here once the owner finalizes a month.')}`;
}};

document.addEventListener('click', e => {
  const a = e.target.closest('[data-att],[data-attday],[data-lv],[data-slip]'); if (!a) return;
  if (a.dataset.attday) { const [u, d] = a.dataset.attday.split('|'); return dayModal(u, d); }
  if (a.dataset.lv) return leaveAction(a.dataset.lv, a.dataset.id);
  if (a.dataset.slip) { const p = (A.slips || []).find(x => x.month === a.dataset.slip); return p && showPayslip(p); }
  const k = a.dataset.att;
  if (k === 'in' || k === 'out') capture(k);
  else if (k === 'leave') leaveForm();
  else if (k === 'print') { document.body.classList.add('printing'); setTimeout(() => { window.print(); setTimeout(() => document.body.classList.remove('printing'), 500); }, 50); }
});
// keep the "time so far" / late banner fresh on the Today screen
setInterval(() => { if (!$('#modal') && staffRole() && ['today', 'myatt', ''].includes(location.hash.replace(/^#\/?/, '').split('/')[0])) render(); }, 60000);
DB.on(w => { if (w === 'auth') return; if (A.dirty && !$('#modal')) { A.dirty = false; render(); } });

return {A, mocksOf, MOCK_MSG, lightbox, STAT, DOW, dayStatus, summarize, calendar, legend, dayModal, leaveLi, showPayslip, payslipHTML, todayCard, watchMonth, watchPayroll, photo, override, lateMin, hoursOf, fmtH, flagTags, holiday, isWO, daysOf, byDate, monthsBack, joinOf, staffRole, withTimeout, words, LT};
})();
