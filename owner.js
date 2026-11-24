/* LE Sales — owner panel: live feed from Firestore via onSnapshot */
(() => {
const {esc, money, today, nice, niceLong, time, map} = LE;
const $ = s => document.querySelector(s);
const OK = 'le_owner';
let O = (() => { try { return JSON.parse(localStorage.getItem(OK)) || {}; } catch { return {}; } })();
let recent = new Map(), openQ = new Map(), day = today(), fresh = new Set(), first = true, newCount = 0;
const v = $('#view');
const saveO = () => localStorage.setItem(OK, JSON.stringify(O));

function status(s) {
  const t = {live: ['live', 'Live'], connecting: ['wait', 'Connecting…'], offline: ['wait', 'Offline'], error: ['', 'Sync error'], local: ['', 'Not connected']}[s] || ['', s];
  $('#who').innerHTML = `<span class="dot ${t[0]}"></span>${t[1]}`;
}
LESync.onState(s => s !== 'online' && status(s));

/* ---- gate ---- */
function gate() {
  const setup = !O.pinHash;
  v.innerHTML = `<div class="lock"><div class="mark" style="margin:0 auto 14px;width:56px;height:56px"><svg viewBox="0 0 24 24" style="width:28px;height:28px"><use href="#i-bolt"/></svg></div>
   <h1>${setup ? 'Set up owner panel' : 'Owner PIN'}</h1>
   <p class="sub">${setup ? 'Choose an owner PIN for this device and enter the private team code.' : 'Enter your PIN'}</p>
   <form id="g" style="text-align:left">
     <label>Owner PIN (4–8 digits)<input name="pin" inputmode="numeric" maxlength="8" autocomplete="off" required></label>
     ${setup ? `<label>Team code (same one typed in salespeople's phones)<input name="team" required minlength="8" autocapitalize="off" autocomplete="off" style="letter-spacing:0;font-size:17px;text-align:left"></label>` : ''}
     <button class="btn pri full" style="margin-top:14px">${setup ? 'Save &amp; open' : 'Unlock'}</button>
   </form>
   ${setup ? '' : '<p class="note"><a href="#" id="reset" style="color:var(--dim)">Forgot PIN / change team code</a></p>'}</div>`;
  $('#g').onsubmit = async e => {
    e.preventDefault(); const f = e.target, pin = f.pin.value.trim();
    if (!/^\d{4,8}$/.test(pin)) return LE.toast('PIN must be 4–8 digits');
    const h = await LE.sha('owner:' + pin);
    if (setup) { O = {pinHash: h, team: f.team.value.trim()}; saveO(); }
    else if (h !== O.pinHash) { f.pin.value = ''; return LE.toast('Wrong PIN'); }
    sessionStorage.setItem('le_owner_ok', '1'); boot();
  };
  $('#reset') && ($('#reset').onclick = e => { e.preventDefault(); if (confirm('Reset owner PIN and team code on this device?')) { localStorage.removeItem(OK); O = {}; gate(); } });
}

/* ---- data ---- */
async function boot() {
  if (!LESync.configured()) {
    status('local');
    v.innerHTML = `<h1>Owner panel</h1><div class="banner">Live sync is not switched on yet. Create the free Firebase project and paste its config into <b>firebase-config.js</b> (see SETUP.md). Until then, salespeople send the daily report on WhatsApp.</div>`;
    return;
  }
  render();
  const ok = await LESync.start(O.team);
  if (!ok) { v.insertAdjacentHTML('afterbegin', `<div class="banner">Could not connect to live sync. Check internet / Firebase setup. Retrying when online.</div>`); addEventListener('online', () => location.reload(), {once: true}); return; }
  const from = LE.addDays(today(), -45);
  LESync.watch(c => c.where('date', '>=', from), (docs, changed) => { recent = new Map(docs.map(d => [d.id, d])); mark(changed); render(); }, err);
  LESync.watch(c => c.where('open', '==', true), docs => { openQ = new Map(docs.map(d => [d.id, d])); render(); }, err);
}
function err(e) { status('error'); LE.toast('Live sync error: ' + (e.code || e.message)); }
function mark(ids) {
  if (first) { first = false; return; }
  ids.forEach(id => fresh.add(id)); newCount += ids.length;
  if (ids.length) { document.title = `(${newCount}) LE Owner panel`; LE.toast(`🔔 ${ids.length} new update(s)`); try { navigator.vibrate?.(80); } catch {} }
  setTimeout(() => { ids.forEach(id => fresh.delete(id)); }, 4000);
}
addEventListener('focus', () => { newCount = 0; document.title = 'LE Sales — Owner panel'; });

const live = () => [...recent.values()].filter(r => !r.deleted);
const sum = (a, f) => a.reduce((s, r) => s + (Number(r[f]) || 0), 0);

function render() {
  const all = live(), d = all.filter(r => r.date === day);
  const reps = [...new Set(all.map(r => r.rep || '—'))].sort();
  const K = k => d.filter(r => r.kind === k);
  const vis = K('visit'), q = K('quote'), o = K('order'), p = K('payment');
  const due = [...openQ.values()].filter(r => !r.deleted && LE.isOpen(r) && r.followUp && r.followUp <= today()).sort((a, b) => a.followUp.localeCompare(b.followUp));
  const modes = LE.MODES.map(m => [m, sum(p.filter(x => x.mode === m), 'amount')]);
  const repRows = reps.map(rep => {
    const R = d.filter(r => (r.rep || '—') === rep), last = all.filter(r => (r.rep || '—') === rep && r.kind === 'visit' && r.lat != null).sort((a, b) => b.ts - a.ts)[0];
    const lastAny = all.filter(r => (r.rep || '—') === rep).sort((a, b) => b.ts - a.ts)[0];
    return `<tr><td><b>${esc(rep)}</b><div class="note" style="margin:2px 0 0">Last: ${lastAny ? nice(lastAny.date) + ' ' + time(lastAny.ts) : '—'}${last ? ` · <a style="color:var(--cyan)" target="_blank" rel="noopener" href="${map(last.lat, last.lng)}">📍 last visit</a>` : ''}</div></td>
      <td class="r">${R.filter(r => r.kind === 'visit').length}</td><td class="r">${money(sum(R.filter(r => r.kind === 'quote'), 'value'))}</td>
      <td class="r">${money(sum(R.filter(r => r.kind === 'order'), 'value'))}</td><td class="r">${money(sum(R.filter(r => r.kind === 'payment'), 'amount'))}</td></tr>`;
  }).join('');
  const feed = d.slice().sort((a, b) => b.ts - a.ts);
  const dayChips = [[today(), 'Today'], [LE.addDays(today(), -1), 'Yesterday']].map(([ds, l]) => `<button class="chip ${day === ds ? 'on' : ''}" data-day="${ds}">${l}</button>`).join('');
  v.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:10px;flex-wrap:wrap"><div><h1>Sales — ${niceLong(day)}</h1><p class="sub">Updates appear live as salespeople save entries.</p></div>
    <div class="seg">${dayChips}<input type="date" id="dpick" value="${day}" max="${today()}" style="min-height:44px;width:auto;margin:0;padding:6px 10px;font-size:15px"></div></div>
   <div class="stats o">
    <div class="stat cyan"><div class="n">${vis.length}</div><div class="l">Visits</div></div>
    <div class="stat amber"><div class="n">${money(sum(q, 'value'))}</div><div class="l">${q.length} quotation(s)</div></div>
    <div class="stat green"><div class="n">${money(sum(o, 'value'))}</div><div class="l">${o.length} order(s)</div></div>
    <div class="stat"><div class="n">${money(sum(p, 'amount'))}</div><div class="l">Collected · ${modes.filter(m => m[1]).map(([m, x]) => m + ' ' + money(x)).join(', ') || 'none'}</div></div>
    <div class="stat" style="border-color:${due.length ? 'rgba(255,107,107,.4)' : 'var(--line)'}"><div class="n" style="color:${due.length ? 'var(--red)' : 'inherit'}">${due.length}</div><div class="l">Follow-ups due / overdue</div></div>
   </div>
   <div class="ogrid" style="margin-top:6px">
    <section><h2>Per salesperson</h2><div class="card tblwrap"><table><thead><tr><th>Salesperson</th><th class="r">Visits</th><th class="r">Quotes</th><th class="r">Orders</th><th class="r">Collected</th></tr></thead>
      <tbody>${repRows || '<tr><td colspan="5" class="note">No data yet</td></tr>'}</tbody></table></div>
      <h2>Live feed (${feed.length})</h2><div class="list">${feed.length ? feed.map(item).join('') : '<div class="empty">No entries for this day yet.</div>'}</div></section>
    <section><h2>⏰ Follow-ups due (${due.length})</h2><div class="list">${due.length ? due.map(fu).join('') : '<div class="empty">No follow-ups due 👍</div>'}</div>
      <h2>Export</h2><div class="card"><button class="btn full" id="csv">⬇️ Download CSV (last 45 days)</button><p class="note">Owner panel shows the last 45 days. Each phone also keeps its full history with CSV/JSON backup.</p>
      <button class="btn ghost sm" id="lockBtn" style="margin-top:8px">🔒 Lock panel</button></div></section>
   </div>`;
  v.querySelectorAll('[data-day]').forEach(b => b.onclick = () => { day = b.dataset.day; render(); });
  $('#dpick').onchange = e => { day = e.target.value || today(); render(); };
  $('#csv').onclick = () => LE.download(`le-sales-all-${today()}.csv`, LE.toCSV([...recent.values()].sort((a, b) => a.ts - b.ts)), 'text/csv;charset=utf-8');
  $('#lockBtn').onclick = () => { sessionStorage.removeItem('le_owner_ok'); location.reload(); };
}
function item(r) {
  const c = esc(r.customer || '—'); let h = c, m = '';
  if (r.kind === 'visit') m = [r.ctype, r.contact, r.phone, r.requirement, r.products].filter(Boolean).map(esc).join(' · ') + (r.lat != null ? ` · <a href="${map(r.lat, r.lng)}" target="_blank" rel="noopener">📍 Map (±${Math.round(r.accuracy)}m)</a>` : ' · <span style="color:var(--red)">No GPS</span>');
  if (r.kind === 'quote') { h += ` <span class="amt">${money(r.value)}</span>`; m = `<span class="tag ${r.status}">${esc(r.status)}</span>${r.followUp ? ' Follow-up ' + nice(r.followUp) : ''}${r.expected ? ' · Exp. order ' + nice(r.expected) : ''}${r.note ? ' · ' + esc(r.note) : ''}`; }
  if (r.kind === 'order') { h += ` <span class="amt">${money(r.value)}</span>`; m = esc(r.items || ''); }
  if (r.kind === 'payment') { h += ` <span class="amt">${money(r.amount)}</span>`; m = esc([r.mode, r.ref].filter(Boolean).join(' · ')); }
  return `<div class="item ${fresh.has(r.id) ? 'new' : ''}"><div class="h"><span>${h}</span><span class="note" style="margin:0">${esc(r.rep || '')}</span></div>
    <div class="m"><span class="tag ${r.kind}">${LE.KINDS[r.kind]}</span> ${time(r.ts)}${m ? ' · ' + m : ''}</div></div>`;
}
function fu(q) {
  const od = q.followUp < today(), ph = (q.phone || '').replace(/\D/g, '');
  return `<div class="item"><div class="h"><span>${esc(q.customer)}</span><span class="amt">${money(q.value)}</span></div>
   <div class="m"><span class="tag ${od ? 'overdue' : q.status}">${od ? 'Overdue' : 'Today'}</span> ${nice(q.followUp)} · ${esc(q.rep || '')} · ${esc(q.status)}${ph ? ` · <a href="tel:${ph}">📞 ${esc(q.phone)}</a>` : ''}</div></div>`;
}

window.LEOwner = {inject(docs) { recent = new Map(docs.map(d => [d.id, d])); openQ = new Map(docs.filter(LE.isOpen).map(d => [d.id, d])); render(); }};
if (O.pinHash && sessionStorage.getItem('le_owner_ok')) boot(); else gate();
})();
