/* LE Sales — salesperson app. Offline-first, localStorage. */
(() => {
const {esc, money, today, nice, niceLong, time, uid, map} = LE;
const $ = (s, el = document) => el.querySelector(s);
const RKEY = 'le_records', SKEY = 'le_settings';
let recs = load(RKEY, []), S = load(SKEY, {name: '', owner: '917004221338', team: '', pinHash: ''});
let tab = 'home', recFilter = 'all';
function load(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }
const persist = () => localStorage.setItem(RKEY, JSON.stringify(recs));
const saveS = () => localStorage.setItem(SKEY, JSON.stringify(S));
const live = () => recs.filter(r => !r.deleted);
const byId = id => recs.find(r => r.id === id);

function upsert(r) {
  r.upd = Date.now(); r.rep = r.rep || S.name;
  const i = recs.findIndex(x => x.id === r.id); i >= 0 ? recs[i] = r : recs.push(r);
  persist(); LESync.queue(r.id); LESync.flush(byId); header();
}
function newRec(kind, data) { const now = Date.now(); return Object.assign({id: uid(), kind, rep: S.name, date: today(), ts: now}, data); }

/* ---------- header / sync status ---------- */
function header() {
  const p = LESync.pending().length, st = LESync.state;
  let dot = '', txt = '';
  if (!LESync.configured() || !S.team) { txt = 'Local only'; }
  else if (st === 'live' && !p) { dot = 'live'; txt = 'Live · synced'; }
  else if (st === 'live' || st === 'connecting') { dot = 'wait'; txt = `Syncing ${p}`; }
  else { dot = 'wait'; txt = `Offline · ${p} queued`; }
  $('#who').innerHTML = `${esc(S.name || '')}<br><span class="dot ${dot}"></span>${txt}`;
  const due = dueQuotes().filter(q => q.followUp <= today()).length;
  const b = $('#fbadge'); b.hidden = !due; b.textContent = due;
}
LESync.onState(s => { header(); if (s === 'online' || s === 'live') LESync.flush(byId); });

/* ---------- derived ---------- */
const dueQuotes = () => live().filter(LE.isOpen).filter(q => q.followUp).sort((a, b) => a.followUp.localeCompare(b.followUp));
const ofDay = (d, kind) => live().filter(r => r.date === d && (!kind || r.kind === kind));
const sum = (a, f) => a.reduce((s, r) => s + (Number(r[f]) || 0), 0);
const customers = () => { const m = {}; live().sort((a, b) => a.ts - b.ts).forEach(r => { if (r.customer) m[r.customer.trim().toLowerCase()] = r; }); return Object.values(m); };

/* ---------- views ---------- */
function render() {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const v = $('#view');
  $('.tabs').hidden = !S.name;
  if (!S.name) { v.innerHTML = setupHTML(true); bindSettings(); header(); return; }
  v.innerHTML = ({home: homeHTML, follow: followHTML, records: recordsHTML, settings: () => setupHTML(false)})[tab]();
  if (tab === 'settings') bindSettings();
  header(); scrollTo(0, 0);
}

function homeHTML() {
  const d = today(), vis = ofDay(d, 'visit'), q = ofDay(d, 'quote'), o = ofDay(d, 'order'), p = ofDay(d, 'payment');
  const due = dueQuotes().filter(x => x.followUp <= d);
  const feed = ofDay(d).sort((a, b) => b.ts - a.ts);
  return `<h1>Namaste, ${esc(S.name.split(' ')[0])} 👋</h1><p class="sub">${niceLong(d)}</p>
  <div class="stats">
    <div class="stat cyan"><div class="n">${vis.length}</div><div class="l">Visits today</div></div>
    <div class="stat amber"><div class="n">${money(sum(q, 'value'))}</div><div class="l">${q.length} quotation(s)</div></div>
    <div class="stat green"><div class="n">${money(sum(o, 'value'))}</div><div class="l">${o.length} order(s)</div></div>
    <div class="stat"><div class="n">${money(sum(p, 'amount'))}</div><div class="l">${p.length} collection(s)</div></div>
  </div>
  <div class="actions">
    <button class="big" data-new="visit"><span>📍</span>New visit<small>Shop visit with GPS</small></button>
    <button class="big" data-new="quote"><span>📝</span>Quotation<small>Value + follow-up</small></button>
    <button class="big" data-new="order"><span>📦</span>Order taken<small>Value + items</small></button>
    <button class="big" data-new="payment"><span>💰</span>Payment<small>Cash / UPI / Cheque</small></button>
  </div>
  <button class="btn wa full" id="reportBtn" style="margin-top:14px;min-height:58px;font-size:17px">📤 Send daily report on WhatsApp</button>
  ${due.length ? `<h2>⏰ Follow-ups due (${due.length})</h2><div class="list">${due.slice(0, 5).map(quoteItem).join('')}</div>` : ''}
  <h2>Today's entries</h2>
  <div class="list">${feed.length ? feed.map(item).join('') : '<div class="empty">No entries yet today. Tap “New visit” when you reach a customer.</div>'}</div>`;
}

function followHTML() {
  const d = today(), all = dueQuotes();
  const od = all.filter(q => q.followUp < d), td = all.filter(q => q.followUp === d), up = all.filter(q => q.followUp > d);
  const sec = (t, a, e) => `<h2>${t} (${a.length})</h2><div class="list">${a.length ? a.map(quoteItem).join('') : `<div class="empty">${e}</div>`}</div>`;
  return `<h1>Follow-ups</h1><p class="sub">Open quotations (hot / warm / cold) by follow-up date</p>
  ${sec('🔴 Overdue', od, 'Nothing overdue 👍')}${sec('🟡 Today', td, 'No follow-ups today')}${sec('Upcoming', up, 'No upcoming follow-ups')}`;
}

function recordsHTML() {
  const a = live().filter(r => recFilter === 'all' || r.kind === recFilter).sort((x, y) => y.ts - x.ts);
  const chips = [['all', 'All'], ['visit', 'Visits'], ['quote', 'Quotes'], ['order', 'Orders'], ['payment', 'Payments']]
    .map(([k, l]) => `<button class="chip ${recFilter === k ? 'on' : ''}" data-filter="${k}">${l}</button>`).join('');
  return `<h1>All records</h1><p class="sub">${live().length} saved on this phone</p>
  <div class="seg" style="margin-top:12px">${chips}</div>
  <div class="list" style="margin-top:12px">${a.length ? a.slice(0, 300).map(r => item(r, true)).join('') : '<div class="empty">No records</div>'}</div>`;
}

function setupHTML(first) {
  const cfg = LESync.configured();
  return `<h1>${first ? 'Welcome to LE Sales' : 'Settings'}</h1>
  <p class="sub">${first ? 'Lalit Enterprises salesperson app. Enter your name once.' : 'Your details on this phone'}</p>
  <form id="setForm" class="card" style="margin-top:14px">
    <label>Your name *<input name="name" required value="${esc(S.name)}" placeholder="e.g. Rahul Kumar" autocomplete="name"></label>
    <label>App PIN (4 digits, optional)<input name="pin" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" placeholder="${S.pinHash ? '•••• (set) — type new to change' : 'Lock app with a PIN'}"></label>
    <label>Owner WhatsApp number (for daily report)<input name="owner" inputmode="tel" value="${esc(S.owner)}"></label>
    <label>Team code (for live sync to owner)<input name="team" value="${esc(S.team)}" placeholder="${cfg ? 'Ask owner for team code' : 'Live sync not set up yet'}" autocapitalize="off" autocomplete="off"></label>
    <p class="note">${cfg ? 'Live sync is available. With the team code, every entry reaches the owner panel in real time (queued when offline).' : 'Live sync is not switched on yet — entries stay on this phone; use the WhatsApp daily report.'}</p>
    <div class="formbtns" style="position:static"><button class="btn pri" type="submit">Save</button></div>
  </form>
  ${first ? '' : `<h2>Backup &amp; export</h2><div class="card">
    <div class="row"><button class="btn" id="csvBtn">⬇️ Export CSV</button><button class="btn" id="bakBtn">💾 Backup (JSON)</button></div>
    <label class="fld">Restore from backup file<input type="file" id="restore" accept="application/json,.json"></label>
    <p class="note">Data lives on this phone. Take a backup every week, or keep live sync on.</p>
    <p class="note">${LESync.pending().length} entr${LESync.pending().length === 1 ? 'y' : 'ies'} waiting to sync.</p></div>`}`;
}

/* ---------- items ---------- */
function item(r, actions) {
  const c = esc(r.customer || '—');
  let h = '', m = '';
  if (r.kind === 'visit') { h = c; m = [r.ctype, r.contact, r.requirement].filter(Boolean).map(esc).join(' · ') + (r.lat != null ? ` · <a href="${map(r.lat, r.lng)}" target="_blank" rel="noopener">📍 Map (±${Math.round(r.accuracy)}m)</a>` : ' · <span style="color:var(--red)">No GPS</span>'); }
  if (r.kind === 'quote') { h = `${c} <span class="amt">${money(r.value)}</span>`; m = `<span class="tag ${r.status}">${r.status}</span> ${r.followUp ? '· Follow-up ' + nice(r.followUp) : ''}${r.expected ? ' · Exp. order ' + nice(r.expected) : ''}`; }
  if (r.kind === 'order') { h = `${c} <span class="amt">${money(r.value)}</span>`; m = esc(r.items || ''); }
  if (r.kind === 'payment') { h = `${c} <span class="amt">${money(r.amount)}</span>`; m = esc([r.mode, r.ref].filter(Boolean).join(' · ')); }
  return `<div class="item"><div class="h"><span>${h}</span></div>
    <div class="m"><span class="tag ${r.kind}">${LE.KINDS[r.kind]}</span> ${actions ? nice(r.date) + ' ' : ''}${time(r.ts)}${m ? ' · ' + m : ''}</div>
    ${actions ? `<div class="a">${r.kind === 'quote' ? `<button class="btn sm" data-editq="${r.id}">Update</button>` : ''}<button class="btn sm danger" data-del="${r.id}">Delete</button></div>` : ''}</div>`;
}
function quoteItem(q) {
  const od = q.followUp < today();
  const ph = (q.phone || '').replace(/\D/g, '');
  return `<div class="item"><div class="h"><span>${esc(q.customer)}</span><span class="amt">${money(q.value)}</span></div>
   <div class="m"><span class="tag ${od ? 'overdue' : q.status}">${od ? 'Overdue' : q.status}</span> Follow-up ${nice(q.followUp)} · quoted ${nice(q.date)}${q.note ? ' · ' + esc(q.note) : ''}</div>
   <div class="a"><button class="btn sm pri" data-editq="${q.id}">Update</button>${ph ? `<a class="btn sm" href="tel:${ph}">📞 Call</a><a class="btn sm" target="_blank" rel="noopener" href="https://wa.me/${ph.length === 10 ? '91' + ph : ph}">WhatsApp</a>` : ''}</div></div>`;
}

/* ---------- sheets / forms ---------- */
const sheet = $('#sheet'), sheetIn = $('#sheetIn');
function open(html) { sheetIn.innerHTML = html; sheet.hidden = false; document.body.style.overflow = 'hidden'; }
function close() { sheet.hidden = true; sheetIn.innerHTML = ''; document.body.style.overflow = ''; }
sheet.addEventListener('click', e => { if (e.target === sheet || e.target.closest('.x,[data-close]')) close(); });

const custField = (v = '') => `<label>Customer / firm name *<input name="customer" required list="custList" value="${esc(v)}" autocomplete="off" placeholder="Shop or company name"></label>
  <datalist id="custList">${customers().map(c => `<option value="${esc(c.customer)}">`).join('')}</datalist>`;
const chips = (name, opts, val, cls = '') => `<div class="chips" data-chips="${name}">${opts.map(o => `<button type="button" class="chip ${cls ? o.toLowerCase() : ''} ${String(val).toLowerCase() === o.toLowerCase() ? 'on' : ''}" data-v="${o}">${o}</button>`).join('')}</div><input type="hidden" name="${name}" value="${esc(val)}">`;
const head = t => `<div class="sheet-h"><h2 style="margin:0">${t}</h2><button type="button" class="x" aria-label="Close">✕</button></div>`;
const btns = () => `<div class="formbtns"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn pri" type="submit">Save</button></div>`;

function form(kind, pre = {}) {
  let body = '';
  if (kind === 'visit') body = `${custField(pre.customer)}
    <label class="fld">Customer type</label>${chips('ctype', LE.TYPES, pre.ctype || 'Retailer')}
    <div class="row"><label>Contact person<input name="contact" value="${esc(pre.contact || '')}"></label><label>Phone<input name="phone" inputmode="tel" value="${esc(pre.phone || '')}"></label></div>
    <label>Requirement<textarea name="requirement" placeholder="What does the customer need?"></textarea></label>
    <label>Products discussed<input name="products" placeholder="e.g. Siemens MCB, Kühl fans, wires"></label>
    <div class="gps" id="gps">📡 Getting your location…</div>
    <input type="hidden" name="lat"><input type="hidden" name="lng"><input type="hidden" name="accuracy"><input type="hidden" name="gpsTs">`;
  if (kind === 'quote') body = `${custField(pre.customer)}
    <div class="row"><label>Quote value (₹) *<input name="value" required inputmode="decimal" type="number" min="0" step="any" value="${esc(pre.value || '')}"></label><label>Phone<input name="phone" inputmode="tel" value="${esc(pre.phone || '')}"></label></div>
    <label class="fld">Status</label>${chips('status', ['Hot', 'Warm', 'Cold', 'Won', 'Lost'], pre.status || 'Warm', 1)}
    <div class="row"><label>Follow-up date<input name="followUp" type="date" value="${pre.followUp || LE.addDays(today(), 2)}"></label><label>Expected order date<input name="expected" type="date" value="${pre.expected || ''}"></label></div>
    <label>Note<input name="note" value="${esc(pre.note || '')}" placeholder="Items / brand / quote no."></label>`;
  if (kind === 'order') body = `${custField(pre.customer)}
    <label>Order value (₹) *<input name="value" required inputmode="decimal" type="number" min="0" step="any" value="${esc(pre.value || '')}"></label>
    <label>Items / note<textarea name="items" placeholder="e.g. 20 MCB 32A Siemens, 5 coils 2.5mm">${esc(pre.items || '')}</textarea></label>`;
  if (kind === 'payment') body = `${custField(pre.customer)}
    <label>Amount received (₹) *<input name="amount" required inputmode="decimal" type="number" min="0" step="any"></label>
    <label class="fld">Mode</label>${chips('mode', LE.MODES, 'Cash')}
    <label>Reference (UPI ID / cheque no. / UTR)<input name="ref"></label>`;
  open(`<form id="f" data-kind="${kind}" data-id="${pre.id || ''}">${head((pre.id ? 'Update ' : 'New ') + LE.KINDS[kind].toLowerCase())}${body}${btns()}</form>`);
  const f = $('#f');
  f.addEventListener('click', e => { const c = e.target.closest('.chip'); if (!c) return; const g = c.parentElement; g.querySelectorAll('.chip').forEach(x => x.classList.remove('on')); c.classList.add('on'); f.elements[g.dataset.chips].value = c.dataset.v; });
  f.customer.addEventListener('change', () => { // autofill from last record
    const c = customers().find(x => x.customer.trim().toLowerCase() === f.customer.value.trim().toLowerCase()); if (!c) return;
    ['contact', 'phone'].forEach(k => { if (f[k] && !f[k].value && c[k]) f[k].value = c[k]; });
    if (f.ctype && c.ctype) { f.ctype.value = c.ctype; f.querySelectorAll('[data-chips=ctype] .chip').forEach(x => x.classList.toggle('on', x.dataset.v === c.ctype)); }
  });
  if (kind === 'visit') gps(f);
  f.addEventListener('submit', e => { e.preventDefault(); submit(f); });
}

function gps(f) {
  const box = $('#gps');
  if (!navigator.geolocation) { box.textContent = '⚠️ GPS not available on this phone'; return; }
  box.className = 'gps'; box.innerHTML = '📡 Getting your location…';
  navigator.geolocation.getCurrentPosition(p => {
    const {latitude: la, longitude: ln, accuracy: ac} = p.coords;
    Object.assign(f.lat, {value: la}); f.lng.value = ln; f.accuracy.value = ac; f.gpsTs.value = p.timestamp;
    box.className = 'gps ok'; box.innerHTML = `✅ Location captured (±${Math.round(ac)} m) · <a href="${map(la, ln)}" target="_blank" rel="noopener">View on map</a> · <a href="#" data-regps>Refresh</a>`;
  }, err => {
    box.className = 'gps'; box.innerHTML = `⚠️ Location not captured (${esc(err.message || 'denied')}). Turn on GPS and allow location. <button type="button" class="btn sm" data-regps>Try again</button>`;
  }, {enableHighAccuracy: true, timeout: 20000, maximumAge: 30000});
  box.onclick = e => { if (e.target.closest('[data-regps]')) { e.preventDefault(); gps(f); } };
}

function submit(f) {
  const kind = f.dataset.kind, id = f.dataset.id, fd = Object.fromEntries(new FormData(f));
  Object.keys(fd).forEach(k => typeof fd[k] === 'string' && (fd[k] = fd[k].trim()));
  if (kind === 'visit') {
    if (fd.lat) { fd.lat = +fd.lat; fd.lng = +fd.lng; fd.accuracy = +fd.accuracy; fd.gpsTs = +fd.gpsTs; }
    else { if (!confirm('Location not captured. Save visit without GPS?')) return; delete fd.lat; delete fd.lng; delete fd.accuracy; delete fd.gpsTs; }
  }
  if (fd.value) fd.value = +fd.value; if (fd.amount) fd.amount = +fd.amount;
  if (fd.status) fd.status = fd.status.toLowerCase();
  const r = id ? Object.assign(byId(id), fd) : newRec(kind, fd);
  upsert(r); close(); render();
  LE.toast(`✅ ${LE.KINDS[kind]} saved${LESync.configured() && S.team ? ' · syncing' : ''}`);
  if (kind === 'quote' && r.status === 'won' && confirm('Quotation won 🎉 Add it as an order now?')) form('order', {customer: r.customer, value: r.value, items: r.note});
}

/* ---------- daily report ---------- */
function reportText(d = today()) {
  const vis = ofDay(d, 'visit').sort((a, b) => a.ts - b.ts), q = ofDay(d, 'quote'), o = ofDay(d, 'order'), p = ofDay(d, 'payment');
  const tm = LE.addDays(d, 1), fu = dueQuotes().filter(x => x.followUp === tm), od = dueQuotes().filter(x => x.followUp < d);
  const L = [`*Lalit Enterprises – Daily Sales Report*`, `Salesperson: ${S.name}`, `Date: ${niceLong(d)}`, ''];
  L.push(`*Visits: ${vis.length}*`);
  vis.forEach((v, i) => L.push(`${i + 1}. ${v.customer}${v.ctype ? ' (' + v.ctype + ')' : ''} ${time(v.ts)}${v.requirement ? ' – ' + v.requirement : ''}${v.lat != null ? '\n   📍 ' + map(v.lat.toFixed(5), v.lng.toFixed(5)) : ' – no GPS'}`));
  L.push('', `*Quotations: ${q.length} · ${money(sum(q, 'value'))}*`);
  q.forEach(x => L.push(`• ${x.customer} ${money(x.value)} (${x.status})${x.followUp ? ' – follow-up ' + nice(x.followUp) : ''}`));
  L.push('', `*Orders: ${o.length} · ${money(sum(o, 'value'))}*`);
  o.forEach(x => L.push(`• ${x.customer} ${money(x.value)}${x.items ? ' – ' + x.items : ''}`));
  L.push('', `*Collections: ${money(sum(p, 'amount'))}*`);
  const modes = LE.MODES.map(m => [m, sum(p.filter(x => x.mode === m), 'amount')]).filter(x => x[1]);
  if (modes.length) L.push(modes.map(([m, v]) => `${m} ${money(v)}`).join(' | '));
  p.forEach(x => L.push(`• ${x.customer} ${money(x.amount)} ${x.mode}${x.ref ? ' (' + x.ref + ')' : ''}`));
  L.push('', `*Follow-ups tomorrow (${nice(tm)}): ${fu.length}*`);
  fu.forEach(x => L.push(`• ${x.customer} ${money(x.value)} (${x.status})`));
  if (od.length) L.push('', `⚠️ Overdue follow-ups: ${od.length}`, ...od.map(x => `• ${x.customer} ${money(x.value)} – due ${nice(x.followUp)}`));
  return L.join('\n');
}
const waLink = t => `https://wa.me/${(S.owner || '917004221338').replace(/\D/g, '')}?text=${encodeURIComponent(t)}`;
function report() {
  const t = reportText();
  open(`${head('Daily report')}<p class="sub">Check it, then tap Send. WhatsApp will open with this message ready for the owner.</p>
   <pre class="report" id="repText">${esc(t)}</pre>
   <div class="formbtns"><button class="btn" id="copyRep">Copy</button><a class="btn wa" id="waSend" href="${waLink(t)}" target="_blank" rel="noopener">📤 Send on WhatsApp</a></div>`);
  $('#copyRep').onclick = () => navigator.clipboard?.writeText(t).then(() => LE.toast('Copied'));
}

/* ---------- settings ---------- */
function bindSettings() {
  $('#setForm').addEventListener('submit', async e => {
    e.preventDefault(); const f = e.target;
    const oldName = S.name;
    S.name = f.name.value.trim(); S.owner = f.owner.value.replace(/[^\d]/g, '') || '917004221338';
    if (f.pin.value) { if (!/^\d{4}$/.test(f.pin.value)) return alert('PIN must be 4 digits'); S.pinHash = await LE.sha(f.pin.value); sessionStorage.setItem('le_unlocked', '1'); }
    const t = f.team.value.trim();
    if (t && t.length < 8) return alert('Team code must be at least 8 characters');
    S.team = t; saveS();
    if (oldName && oldName !== S.name) recs.forEach(r => { if (r.rep === oldName) { r.rep = S.name; LESync.queue(r.id); } }), persist();
    startSync(); LE.toast('Saved'); tab = 'home'; render();
  });
  $('#csvBtn')?.addEventListener('click', () => LE.download(`le-sales-${S.name.replace(/\s+/g, '-')}-${today()}.csv`, LE.toCSV(recs.slice().sort((a, b) => a.ts - b.ts)), 'text/csv;charset=utf-8'));
  $('#bakBtn')?.addEventListener('click', () => LE.download(`le-sales-backup-${today()}.json`, JSON.stringify({app: 'le-sales', v: 1, at: new Date().toISOString(), settings: {name: S.name, owner: S.owner}, records: recs}, null, 1), 'application/json'));
  $('#restore')?.addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const j = JSON.parse(await file.text()); if (!Array.isArray(j.records)) throw 0;
      let n = 0;
      j.records.forEach(r => { if (!r.id || !r.kind) return; const cur = byId(r.id); if (!cur || (r.upd || 0) > (cur.upd || 0)) { cur ? Object.assign(cur, r) : recs.push(r); LESync.queue(r.id); n++; } });
      persist(); LESync.flush(byId); LE.toast(`Restored ${n} record(s)`); render();
    } catch { alert('This is not a valid LE Sales backup file'); }
  });
}

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-tab],[data-new],[data-editq],[data-del],[data-filter],#reportBtn'); if (!t) return;
  if (t.dataset.tab) { tab = t.dataset.tab; render(); }
  else if (t.dataset.new) form(t.dataset.new);
  else if (t.dataset.editq) form('quote', byId(t.dataset.editq));
  else if (t.dataset.del) { const r = byId(t.dataset.del); if (confirm(`Delete this ${LE.KINDS[r.kind].toLowerCase()} for ${r.customer}?`)) { r.deleted = true; upsert(r); render(); } }
  else if (t.dataset.filter) { recFilter = t.dataset.filter; render(); }
  else if (t.id === 'reportBtn') report();
});

/* ---------- PIN lock ---------- */
function lock() {
  $('#view').innerHTML = `<div class="lock"><div class="mark" style="margin:0 auto 14px;width:56px;height:56px"><svg viewBox="0 0 24 24" style="width:28px;height:28px"><use href="#i-bolt"/></svg></div>
   <h1>Enter PIN</h1><p class="sub">${esc(S.name)}</p><form id="pinF"><input id="pinI" inputmode="numeric" maxlength="4" autofocus autocomplete="off"><button class="btn pri full" style="margin-top:12px">Unlock</button></form>
   <p class="note">Forgot PIN? Ask the owner — data can be restored from a backup.</p></div>`;
  $('.tabs').hidden = true;
  $('#pinF').onsubmit = async e => { e.preventDefault(); if (await LE.sha($('#pinI').value) === S.pinHash) { sessionStorage.setItem('le_unlocked', '1'); $('.tabs').hidden = false; render(); } else { $('#pinI').value = ''; LE.toast('Wrong PIN'); } };
}

function startSync() { if (S.team) LESync.start(S.team).then(ok => { if (ok) LESync.flush(byId); header(); }); }

/* expose for testing */
window.LEApp = {reportText, waLink, get records() { return recs; }};
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js');
if (S.pinHash && !sessionStorage.getItem('le_unlocked')) lock(); else render();
startSync();
})();
