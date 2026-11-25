/* LE Sales v3 — admin/manager: Attendance (today board, monthly register, leaves, rules) and Payroll (admin only) */
(() => {
const {esc, money, today, nice, time} = LE;
const {V, st, render, modal, closeModal, mh, kpi, listCard, $, $$} = UI;
const S = DB.S, X = ATT, A = ATT.A;
const fs = () => firebase.firestore();
const seg = (k, opts, def) => `<div class="seg">${Object.entries(opts).map(([v, l]) => `<button data-seg="${k}" data-v="${v}" class="${(st.q[k] || def) === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
const staff = (m) => [...S.users.values()].filter(u => u.role !== 'admin' && (u.active || (m && [...A.month.values()].some(r => r.uid === u.uid)))).sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name));
const monthSel = (k, def, n = 6) => `<select data-sel="${k}" style="width:auto;min-height:38px;margin:0">${X.monthsBack(n).map(x => `<option value="${x}" ${x === (st.q[k] || def) ? 'selected' : ''}>${LE.monthName(x)}</option>`).join('')}</select>`;
const recsOf = (uid, m) => new Map([...A.month.values()].filter(r => r.uid === uid && r.month === m).map(r => [r.date, r]));
const csvq = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
const csv = (head, rows) => '\ufeff' + head.join(',') + '\n' + rows.map(r => r.map(csvq).join(',')).join('\n');
const avatar = u => `<span class="avatar sm">${LE.initials(u.name)}</span>`;
let leavesFor = '', mocksAt = 0;
function monthData(m) {
  X.watchMonth(m);
  if (leavesFor !== m) { leavesFor = m; fs().collection('leaves').where('to', '>=', m + '-01').get().then(s => { s.docs.forEach(d => A.leaves.set(d.id, {id: d.id, ...d.data()})); render(); }).catch(e => console.warn(e)); }
  if (Date.now() - mocksAt > 120000) { mocksAt = Date.now(); fs().collection('locations').where('mock', '==', true).limit(2000).get().then(s => { A.mockDays = new Map(); s.docs.forEach(d => { const x = d.data(), k = x.ownerUid + '|' + x.date, a = A.mockDays.get(k) || []; a.push(x); A.mockDays.set(k, a); }); render(); }).catch(e => console.warn(e)); }
  return A.monthLoaded === m;
}

/* ================= Attendance ================= */
V.attendance = {mgr: true, title: 'Attendance', render() {
  const tab = st.q.at || 'today', pend = [...A.leaves.values()].filter(l => l.status === 'pending').length;
  const tabs = seg('at', {today: 'Today', reg: 'Monthly register', leave: `Leave${pend ? ` (${pend})` : ''}`, rules: 'Rules & holidays'}, 'today');
  const body = tab === 'reg' ? register() : tab === 'leave' ? leaves() : tab === 'rules' ? rules() : board();
  return `<div class="page-h"><div><h1>Attendance</h1><p>Selfie + GPS check-in / check-out · office ${A.settings.start}, grace ${A.settings.grace} min</p></div><div class="toolbar">${tabs}</div></div>${body}`;
}, after(el) {
  $$('[data-thumb]', el).forEach(async t => { const src = await X.photo(t.dataset.thumb); t.innerHTML = src ? `<img src="${src}" alt="">` : icon('camera'); if (src) t.onclick = e => { e.stopPropagation(); X.lightbox(src); }; });
  const rf = $('#rulesf', el); rf && rulesAfter(rf);
  const c = $('#regcsv', el); c && (c.onclick = regCSV);
}};
function board() {
  const d = today(), ppl = staff().filter(u => u.active), rows = ppl.map(u => { const r = A.today.get(u.uid); return {u, r, code: X.dayStatus(u.uid, d, r), late: r && r.inTs && !r.ovStatus ? X.lateMin(r) : 0}; });
  const n = k => rows.filter(x => k.includes(x.code)).length, late = rows.filter(x => x.late).length;
  const order = {IN: 0, P: 1, H: 2, PEND: 3, A: 4, L: 5, LWP: 5, WO: 6, HO: 6};
  rows.sort((a, b) => (order[a.code] ?? 9) - (order[b.code] ?? 9) || a.u.name.localeCompare(b.u.name));
  const now = new Date(), afterStart = now.getHours() * 60 + now.getMinutes() > (+A.settings.start.split(':')[0] * 60 + +A.settings.start.split(':')[1] + +A.settings.grace);
  const item = ({u, r, code, late}) => {
    const loc = (k) => r && r[k + 'Lat'] != null ? `<a href="${LE.map(r[k + 'Lat'], r[k + 'Lng'])}" target="_blank" rel="noopener">📍 ${r[k + 'Addr'] ? esc(r[k + 'Addr'].split(',').slice(0, 2).join(',')) : 'map'} ±${r[k + 'Acc']}m</a>` : r && r[k + 'Ts'] ? '<span style="color:var(--red)">no GPS</span>' : '';
    return `<div class="li tap att-row" data-attday="${u.uid}|${d}"><div class="thumbs">${r && r.inTs ? `<span class="thumb" data-thumb="${u.uid}_${d}_in"></span>` : `<span class="avatar">${LE.initials(u.name)}</span>`}${r && r.outTs ? `<span class="thumb" data-thumb="${u.uid}_${d}_out"></span>` : ''}</div>
      <div class="b"><div class="t"><span>${esc(u.name)}${A.mockToday.has(u.uid) ? ' <span class="tag mock">⚠ Fake GPS</span>' : ''}</span><span class="tag st-${X.STAT[code][1]}">${code === 'PEND' ? (afterStart ? 'Not in' : 'Not yet') : X.STAT[code][0]}</span></div>
      <div class="m">${r && r.inTs ? `<span>In <b>${time(r.inTs)}</b>${late ? ` <span class="tag a">Late ${late}m</span>` : ''}</span><span>·</span><span>${loc('in')}</span>` : `<span>${esc(u.territory || LE.ROLES[u.role])}</span>`}
      ${r && r.outTs ? `<span>·</span><span>Out <b>${time(r.outTs)}</b> · ${X.fmtH(X.hoursOf(r))}</span><span>·</span><span>${loc('out')}</span>` : r && r.inTs ? `<span>·</span><span>${X.fmtH((Date.now() - r.inTs) / 3600000)} so far</span>` : ''}
      ${r && r.ovStatus ? `<span>·</span><span>corrected: ${esc(r.ovReason)}</span>` : ''}</div>${X.flagTags([...(r && r.inFlags || []), ...(r && r.outFlags || [])].filter((x, i, a) => a.indexOf(x) === i))}</div></div>`;
  };
  return `<div class="kpis k4" style="margin-bottom:14px">${kpi('green', 'check', n(['IN', 'P', 'H']), 'Checked in', `${rows.filter(x => x.r && x.r.outTs).length} checked out`)}${kpi('amber', 'clock', late, 'Late today', `after ${A.settings.start} + ${A.settings.grace} min`)}${kpi('red', 'x', n(['PEND', 'A']), afterStart ? 'Not checked in' : 'Not in yet')}${kpi('violet', 'cal', n(['L', 'LWP', 'WO', 'HO']), 'Leave / off')}</div>
    ${A.mockToday.size ? `<div class="mockbar">${icon('alert')}<div><b>Fake GPS detected today</b> — ${[...A.mockToday].map(([uid, pts]) => `${esc((S.users.get(uid) || {}).name || pts[0].ownerName)}: ${pts.length}× from ${time(pts[0].ts)}${pts.some(p => /blocked/.test(p.reason)) ? ' (attendance refused)' : ''}`).join(' · ')}</div></div>` : ''}
    <div class="card-h" style="margin:4px 2px 8px"><h3>${LE.niceLong(d)}</h3><span class="sub">${A.loaded ? 'Live · tap a person for photos, map and corrections' : 'Loading…'}</span></div>
    ${listCard(rows.map(item), 'No employees yet. Add them in Team → Employees.')}`;
}
function register() {
  const m = st.q.am || LE.month(), ok = monthData(m), days = X.daysOf(m), ppl = staff(m);
  const rows = ppl.map(u => ({u, sm: X.summarize(u.uid, m, recsOf(u.uid, m))}));
  st.regRows = {m, rows};
  return `<div class="card pad0"><div class="tbl-tools">${monthSel('am', LE.month())}<span class="note" style="margin:0;flex:1">P present · H half-day · A absent · L leave · WO week-off · HO holiday · <i class="late-dot"></i> late · <i class="ov-dot"></i> corrected · <span class="mock-key">red box</span> fake GPS${DB.isAdmin() ? ' · tap a cell to view / correct' : ''}</span><button class="btn" id="regcsv">${icon('download')}Export CSV</button></div>
    <div class="tbl-wrap reg">${!ok ? '<div class="empty" style="margin:14px">Loading…</div>' : `<table><thead><tr><th class="sticky">Employee</th>${days.map(ds => `<th class="dcol ${X.isWO(ds) || X.holiday(ds) ? 'off' : ''} ${ds === today() ? 'is-today' : ''}">${+ds.slice(8)}<small>${X.DOW[new Date(ds + 'T12:00:00').getDay()][0]}</small></th>`).join('')}<th class="r">P</th><th class="r">H</th><th class="r">A</th><th class="r">L</th><th class="r">Off</th><th class="r">Late</th></tr></thead>
    <tbody>${rows.map(({u, sm}) => `<tr><td class="sticky"><div class="who">${avatar(u)}<b>${esc(u.name)}</b></div></td>${sm.rows.map(({ds, code, r}) => `<td class="rc st-${X.STAT[code][1]}${X.mocksOf(u.uid, ds).length ? ' mock' : ''}" ${r || (code && code !== 'NJ') || X.mocksOf(u.uid, ds).length ? `data-attday="${u.uid}|${ds}"` : ''}>${code && code !== 'NJ' ? code.replace('PEND', '–').replace('IN', 'P').replace('LWP', 'L') : ''}${r && r.inTs && !r.ovStatus && X.lateMin(r) ? '<i class="late"></i>' : ''}${r && r.ovStatus ? '<i class="ov"></i>' : ''}</td>`).join('')}
      <td class="r"><b>${sm.present}</b></td><td class="r">${sm.half}</td><td class="r">${sm.absent}</td><td class="r">${sm.paidLeave + sm.unpaidLeave}</td><td class="r">${sm.weekOffs + sm.holidays}</td><td class="r">${sm.late}</td></tr>`).join('') || `<tr><td colspan="${days.length + 7}"><div class="empty">No employees</div></td></tr>`}</tbody></table>`}</div></div>`;
}
function regCSV() {
  const {m, rows} = st.regRows || {}; if (!m) return;
  const out = [];
  rows.forEach(({u, sm}) => sm.rows.forEach(({ds, code, r}) => out.push([u.name, ds, X.DOW[new Date(ds + 'T12:00:00').getDay()], X.STAT[code][0], r && r.inTs ? new Date(r.inTs).toLocaleTimeString('en-IN') : '', r && r.outTs ? new Date(r.outTs).toLocaleTimeString('en-IN') : '',
    r && r.outTs ? X.hoursOf(r).toFixed(2) : '', r && r.inTs && !r.ovStatus ? X.lateMin(r) || '' : '', r && r.inLat != null ? LE.map(r.inLat, r.inLng) : '', r && r.inAcc != null ? r.inAcc : '', r && r.inAddr || '', r && r.outLat != null ? LE.map(r.outLat, r.outLng) : '', r && r.outAddr || '',
    [...(r && r.inFlags || []), ...(r && r.outFlags || [])].join(' '), r && r.ovStatus ? `${r.ovStatus} by ${r.ovByName || ''}: ${r.ovReason}` : ''])));
  LE.download(`le-attendance-${m}.csv`, csv(['Employee', 'Date', 'Day', 'Status', 'In', 'Out', 'Hours', 'Late (min)', 'In location', 'In accuracy (m)', 'In address', 'Out location', 'Out address', 'Flags', 'Correction'], out), 'text/csv;charset=utf-8');
}
function leaves() {
  const all = [...A.leaves.values()].sort((a, b) => b.createdAt - a.createdAt), pend = all.filter(l => l.status === 'pending'), rest = all.filter(l => l.status !== 'pending').slice(0, 40);
  return `<div class="card-h" style="margin:4px 2px 8px"><h3>Waiting for approval</h3><span class="sub">${pend.length}</span></div>${listCard(pend.map(l => X.leaveLi(l, {admin: DB.isAdmin()})), 'No pending requests 👍')}
    <div class="card-h" style="margin:16px 2px 8px"><h3>Recent</h3><span class="sub">approved / rejected / withdrawn</span></div>${listCard(rest.map(l => X.leaveLi(l, {admin: DB.isAdmin()})), 'Nothing yet')}
    ${DB.isAdmin() ? '' : '<p class="note">Only the admin can approve or reject leave.</p>'}`;
}
function rules() {
  const s = A.settings, dis = DB.isAdmin() ? '' : 'disabled', hol = (s.holidays || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  return `<form id="rulesf" class="card" style="max-width:760px"><div class="card-h"><h3>Working-day rules</h3><span class="sub">${DB.isAdmin() ? 'Used for late marks, register and payroll' : 'View only — admin can change'}</span></div>
    <div class="row2"><label class="f">Office start time<input type="time" name="start" value="${esc(s.start)}" ${dis}></label><label class="f">Grace (minutes before “late”)<input type="number" name="grace" min="0" max="120" value="${s.grace}" ${dis}></label></div>
    <div class="row2"><label class="f">Half-day if worked less than (hours)<input type="number" name="halfHours" min="1" max="12" step="0.5" value="${s.halfHours}" ${dis}></label><label class="f">Late marks for ½-day cut (0 = off)<input type="number" name="latePerHalf" min="0" max="10" value="${s.latePerHalf || 0}" ${dis}></label></div>
    <label class="f">Weekly off</label><div class="chips" style="margin-top:7px">${X.DOW.map((d, i) => `<label class="chip ${s.weekOff.includes(i) ? 'on' : ''}"><input type="checkbox" name="wo" value="${i}" ${s.weekOff.includes(i) ? 'checked' : ''} ${dis} hidden>${d}</label>`).join('')}</div>
    <label class="f">Salary per day based on<select name="basis" ${dis}><option value="calendar" ${s.basis !== 'working' ? 'selected' : ''}>Calendar days (salary ÷ days in month; week-offs &amp; holidays paid) — standard</option><option value="working" ${s.basis === 'working' ? 'selected' : ''}>Working days (salary ÷ working days; only days worked / paid leave)</option></select></label>
    <div class="card-h" style="margin-top:18px"><h3>Holidays</h3><span class="sub">${hol.length}</span></div>
    <div class="list" id="hols">${hol.map(h => `<div class="li"><span class="dot">${icon('cal')}</span><div class="b"><div class="t"><span>${esc(h.name)}</span><span class="amt">${LE.niceLong(h.date)}</span></div></div>${DB.isAdmin() ? `<button type="button" class="icon-btn" data-delhol="${h.date}" title="Remove">${icon('x')}</button>` : ''}</div>`).join('') || '<div class="empty">No holidays added</div>'}</div>
    ${DB.isAdmin() ? `<div class="row2" style="align-items:end"><label class="f">Holiday date<input type="date" name="hd"></label><label class="f">Name<input name="hn" placeholder="e.g. Holi"></label></div><button type="button" class="btn sm" id="addhol" style="margin-top:8px">${icon('plus')}Add holiday</button>
    <div class="modal-f" style="margin-top:18px"><button class="btn pri">Save rules</button></div>` : ''}</form>`;
}
function rulesAfter(f) {
  if (!DB.isAdmin()) return;
  let hol = (A.settings.holidays || []).slice();
  f.addEventListener('click', e => { const c = e.target.closest('label.chip'); if (c) setTimeout(() => c.classList.toggle('on', c.querySelector('input').checked), 0);
    const d = e.target.closest('[data-delhol]'); if (d) { hol = hol.filter(h => h.date !== d.dataset.delhol); d.closest('.li').remove(); } });
  $('#addhol').onclick = () => { const dt = f.hd.value, nm = f.hn.value.trim(); if (!dt || !nm) return LE.toast('Pick a date and type a name'); hol = hol.filter(h => h.date !== dt).concat({date: dt, name: nm.slice(0, 60)}); save(true); };
  const save = async quiet => {
    const d = {start: f.start.value || '10:00', grace: +f.grace.value || 0, halfHours: +f.halfHours.value || 4, latePerHalf: +f.latePerHalf.value || 0, weekOff: $$('[name=wo]:checked', f).map(x => +x.value), holidays: hol.sort((a, b) => a.date.localeCompare(b.date)), basis: f.basis.value, updatedAt: Date.now(), updatedBy: S.user.uid};
    try { await fs().collection('settings').doc('attendance').set(d); LE.toast(quiet ? 'Holiday added' : 'Rules saved'); } catch (e) { LE.toast(LE.errMsg(e)); }
  };
  f.onsubmit = e => { e.preventDefault(); save(); };
}

/* ================= Payroll (admin only) ================= */
const defPayMonth = () => new Date().getDate() <= 10 ? LE.month(LE.addDays(LE.month() + '-01', -1)) : LE.month();
function payRow(u, m) {
  const sal = A.salary.get(u.uid), saved = A.payroll.get(u.uid);
  if (saved && saved.status === 'finalized') return {u, sal, p: saved, saved};
  const monthly = sal ? +sal.monthly || 0 : 0, sm = X.summarize(u.uid, m, recsOf(u.uid, m), monthly), adj = saved || {};
  const p = {uid: u.uid, name: u.name, designation: (sal && sal.designation) || LE.ROLES[u.role], month: m, status: 'draft', monthly, basis: sm.basis, daysInMonth: sm.daysInMonth, workDays: sm.workDays,
    present: sm.present, half: sm.half, paidLeave: sm.paidLeave, unpaidLeave: sm.unpaidLeave, absent: sm.absent, weekOffs: sm.weekOffs, holidays: sm.holidays, late: sm.late, lateCut: sm.lateCut, notJoined: sm.notJoined,
    paidDays: Math.round(sm.paidDays * 100) / 100, perDay: Math.round(sm.perDay * 100) / 100, earned: sm.earned, incentive: +adj.incentive || 0, allowance: +adj.allowance || 0, advance: +adj.advance || 0, deduction: +adj.deduction || 0, notes: adj.notes || ''};
  p.net = Math.round(p.earned + p.incentive + p.allowance - p.advance - p.deduction);
  return {u, sal, p, saved, offWorked: sm.offWorked};
}
V.payroll = {mgr: true, admin: true, title: 'Payroll', render() {
  const tab = st.q.pt || 'run';
  return `<div class="page-h"><div><h1>Payroll</h1><p>Admin only · salary data is never shown to managers</p></div><div class="toolbar">${seg('pt', {run: 'Monthly payroll', sal: 'Salary settings'}, 'run')}</div></div>${tab === 'sal' ? salaries() : run()}`;
}, after(el) {
  $$('[data-salsave]', el).forEach(b => b.onclick = async () => { const tr = b.closest('tr'), v = n => tr.querySelector(`[name=${n}]`).value.trim(); const uid = b.dataset.salsave;
    if (v('monthly') === '' || +v('monthly') < 0) return LE.toast('Enter monthly salary');
    b.disabled = true; try { await fs().collection('salary').doc(uid).set({uid, monthly: Math.round(+v('monthly')), joinDate: v('joinDate'), designation: v('designation').slice(0, 60), updatedAt: Date.now(), updatedBy: S.user.uid}); LE.toast('Salary saved'); } catch (e) { LE.toast(LE.errMsg(e)); } b.disabled = false; });
  const all = $('#payall', el); all && (all.onclick = saveAll);
  const c = $('#paycsv', el); c && (c.onclick = payCSV);
}};
function salaries() {
  const ppl = staff();
  return `<div class="card pad0"><div class="tbl-wrap"><table><thead><tr><th>Employee</th><th>Monthly salary ₹</th><th>Designation</th><th>Joining date</th><th></th></tr></thead><tbody>
    ${ppl.map(u => { const s = A.salary.get(u.uid) || {}; return `<tr><td><div class="who">${avatar(u)}<div><b>${esc(u.name)}</b><div class="pct">${LE.ROLES[u.role]}${u.active ? '' : ' · inactive'}</div></div></div></td>
      <td><input name="monthly" type="number" min="0" step="100" value="${s.monthly ?? ''}" placeholder="—" style="min-height:40px;margin:0;width:140px"></td>
      <td><input name="designation" value="${esc(s.designation || '')}" placeholder="${esc(LE.ROLES[u.role])}" maxlength="60" style="min-height:40px;margin:0;width:180px"></td>
      <td><input name="joinDate" type="date" value="${esc(s.joinDate || (u.createdAt ? LE.dstr(u.createdAt) : ''))}" style="min-height:40px;margin:0;width:160px;font-size:14px"></td>
      <td><button class="btn sm pri" data-salsave="${u.uid}">Save</button></td></tr>`; }).join('') || '<tr><td colspan="5"><div class="empty">Add employees first (Team → Employees)</div></td></tr>'}</tbody></table></div></div>
    <p class="note">Only you (admin) can see salaries. Days before the joining date are not paid. Employees see only their own finalized payslips.</p>`;
}
function run() {
  const m = st.q.pm || defPayMonth(), ok = monthData(m); X.watchPayroll(m);
  const rows = staff(m).map(u => payRow(u, m)), withSal = rows.filter(x => x.sal || x.saved);
  st.payRows = {m, rows: withSal};
  const tot = k => withSal.reduce((s, x) => s + (+x.p[k] || 0), 0), cur = m === LE.month();
  const tag = x => x.saved && x.saved.status === 'finalized' ? '<span class="tag on">Finalized</span>' : x.saved ? '<span class="tag warm">Draft saved</span>' : '<span class="tag">Not saved</span>';
  return `<div class="card pad0"><div class="tbl-tools">${monthSel('pm', defPayMonth())}<span class="note" style="margin:0;flex:1">${A.settings.basis === 'working' ? 'Per day = salary ÷ working days' : 'Per day = salary ÷ days in month (week-offs & holidays paid)'} · paid days = present + ½ half-days + paid leave${A.settings.basis === 'working' ? '' : ' + week-offs + holidays'}${+A.settings.latePerHalf ? ` − ½ day per ${A.settings.latePerHalf} lates` : ''}</span>
    <button class="btn" id="paycsv">${icon('download')}CSV</button><button class="btn pri" id="payall">Save all drafts</button></div>
    ${cur ? '<div class="warnbar">This month is not over yet — figures change until the last day. Finalize after month end.</div>' : ''}
    <div class="tbl-wrap pay">${!ok ? '<div class="empty" style="margin:14px">Loading…</div>' : `<table><thead><tr><th>Employee</th><th class="r">Monthly</th><th class="r">Paid days</th><th class="r">Earned</th><th class="r">+ Incentive</th><th class="r">+ Allow.</th><th class="r">− Advance</th><th class="r">− Deduct.</th><th class="r">Net pay</th><th>Status</th><th></th></tr></thead><tbody>
    ${withSal.map(x => `<tr><td><div class="who">${avatar(x.u)}<div><b>${esc(x.u.name)}</b><div class="pct">P ${x.p.present} · H ${x.p.half} · A ${x.p.absent} · L ${x.p.paidLeave}${x.p.late ? ` · late ${x.p.late}` : ''}</div></div></div></td>
      <td class="r amt">${money(x.p.monthly)}</td><td class="r">${x.p.paidDays}<span class="dim">/${x.p.basis === 'working' ? x.p.workDays : x.p.daysInMonth}</span></td><td class="r amt">${money(x.p.earned)}</td><td class="r">${money(x.p.incentive)}</td><td class="r">${money(x.p.allowance)}</td><td class="r">${money(x.p.advance)}</td><td class="r">${money(x.p.deduction)}</td>
      <td class="r amt"><b>${money(x.p.net)}</b></td><td>${tag(x)}</td><td class="nowrap">${x.p.status === 'finalized' ? '' : `<button class="btn sm" data-payedit="${x.u.uid}">Edit</button> `}<button class="btn sm" data-payslip="${x.u.uid}">${icon('print')}Payslip</button></td></tr>`).join('')
      || `<tr><td colspan="11"><div class="empty">Set monthly salaries first (Salary settings tab).</div></td></tr>`}</tbody>
    ${withSal.length ? `<tfoot><tr><td><b>Total (${withSal.length})</b></td><td class="r amt">${money(tot('monthly'))}</td><td></td><td class="r amt">${money(tot('earned'))}</td><td class="r">${money(tot('incentive'))}</td><td class="r">${money(tot('allowance'))}</td><td class="r">${money(tot('advance'))}</td><td class="r">${money(tot('deduction'))}</td><td class="r amt"><b>${money(tot('net'))}</b></td><td colspan="2"></td></tr></tfoot>` : ''}</table>`}</div></div>
    <p class="note">Edit a row to add incentive, allowance, advance or deductions, then Finalize. Finalized payslips are locked and become visible to that employee in “My payslips”.</p>`;
}
const payDoc = (p, extra = {}) => ({...p, updatedAt: Date.now(), updatedBy: S.user.uid, createdAt: (A.payroll.get(p.uid) || {}).createdAt || Date.now(), ...extra});
async function saveAll() {
  const {rows = []} = st.payRows || {}; const todo = rows.filter(x => x.p.status !== 'finalized'); if (!todo.length) return LE.toast('Nothing to save');
  try { const b = fs().batch(); todo.forEach(x => b.set(fs().collection('payroll').doc(`${x.u.uid}_${x.p.month}`), payDoc(x.p))); await b.commit(); LE.toast(`${todo.length} draft(s) saved`); } catch (e) { LE.toast(LE.errMsg(e)); }
}
function payEdit(uid) {
  const x = (st.payRows.rows || []).find(r => r.u.uid === uid); if (!x) return; const p = x.p;
  const num = (n, l) => `<label class="f">${l}<input name="${n}" type="number" min="0" step="1" value="${p[n] || ''}" placeholder="0"></label>`;
  modal(`<form id="pf">${mh(esc(p.name) + ' · ' + LE.monthName(p.month))}
    <div class="pay-break"><span>Present <b>${p.present}</b></span><span>Half-day <b>${p.half}</b></span><span>Paid leave <b>${p.paidLeave}</b></span><span>Unpaid leave <b>${p.unpaidLeave}</b></span><span>Absent <b>${p.absent}</b></span><span>Week-off <b>${p.weekOffs}</b></span><span>Holiday <b>${p.holidays}</b></span><span>Late <b>${p.late}</b>${p.lateCut ? ` (−${p.lateCut} day)` : ''}</span>${p.notJoined ? `<span>Before joining <b>${p.notJoined}</b></span>` : ''}${x.offWorked ? `<span>Worked on off-day <b>${x.offWorked}</b></span>` : ''}</div>
    <p class="note">${money(p.monthly)} ÷ ${p.basis === 'working' ? p.workDays + ' working' : p.daysInMonth} days = ${money(p.perDay)}/day × <b>${p.paidDays}</b> paid days = <b>${money(p.earned)}</b></p>
    <div class="row2">${num('incentive', 'Incentive ₹')}${num('allowance', 'Allowance (travel, phone…) ₹')}</div><div class="row2">${num('advance', 'Advance recovered ₹')}${num('deduction', 'Other deduction ₹')}</div>
    <label class="f">Note on payslip<input name="notes" maxlength="500" value="${esc(p.notes || '')}" placeholder="optional"></label>
    <div class="ps-net" style="margin-top:12px"><span>Net pay</span><b id="pnet">${money(p.net)}</b></div>
    <div class="modal-f"><button type="button" class="btn ghost" data-close>Cancel</button><button type="button" class="btn" id="pfin">Finalize &amp; lock</button><button class="btn pri">Save draft</button></div></form>`);
  const f = $('#pf'), val = () => { const v = n => Math.max(0, Math.round(+f[n].value || 0)); const q = {...p, incentive: v('incentive'), allowance: v('allowance'), advance: v('advance'), deduction: v('deduction'), notes: f.notes.value.trim().slice(0, 500)}; q.net = Math.round(q.earned + q.incentive + q.allowance - q.advance - q.deduction); return q; };
  f.oninput = () => { $('#pnet').textContent = money(val().net); };
  const write = async fin => { const q = val(); if (fin && !confirm(`Finalize ${q.name}'s payslip for ${LE.monthName(q.month)} — net ${money(q.net)}?\n\nIt will be LOCKED (no more edits) and visible to the employee.`)) return;
    try { await fs().collection('payroll').doc(`${q.uid}_${q.month}`).set(payDoc(q, fin ? {status: 'finalized', finalizedAt: Date.now(), finalizedBy: S.user.uid} : {})); closeModal(); LE.toast(fin ? 'Finalized' : 'Draft saved'); } catch (e) { LE.toast(LE.errMsg(e)); } };
  f.onsubmit = e => { e.preventDefault(); write(false); }; $('#pfin').onclick = () => write(true);
}
function payCSV() {
  const {m, rows = []} = st.payRows || {};
  LE.download(`le-payroll-${m}.csv`, csv(['Employee', 'Designation', 'Month', 'Status', 'Monthly', 'Basis', 'Days in month', 'Working days', 'Present', 'Half-day', 'Paid leave', 'Unpaid leave', 'Absent', 'Week-off', 'Holiday', 'Late', 'Late cut (days)', 'Paid days', 'Per day', 'Earned', 'Incentive', 'Allowance', 'Advance', 'Deduction', 'Net', 'Notes'],
    rows.map(({p}) => [p.name, p.designation, p.month, p.status, p.monthly, p.basis, p.daysInMonth, p.workDays, p.present, p.half, p.paidLeave, p.unpaidLeave, p.absent, p.weekOffs, p.holidays, p.late, p.lateCut, p.paidDays, p.perDay, p.earned, p.incentive, p.allowance, p.advance, p.deduction, p.net, p.notes])), 'text/csv;charset=utf-8');
}
document.addEventListener('click', e => {
  const a = e.target.closest('[data-payedit],[data-payslip]'); if (!a) return;
  if (a.dataset.payedit) return payEdit(a.dataset.payedit);
  const x = (st.payRows && st.payRows.rows || []).find(r => r.u.uid === a.dataset.payslip); x && X.showPayslip(x.p);
});
})();
