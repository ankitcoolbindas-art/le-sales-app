/* LE Sales v2 — manager/admin views: dashboard, activity, map, pipeline, calendar, records, team */
(() => {
const {esc, money, short, today, nice, niceLong, time} = LE;
const {V, st, render, all, openQuotes, dueQuotes, customers, li, fuItem, listCard, kpi, pctBar, modal, closeModal, mh, setStatus, $, $$} = UI;
const S = DB.S;
const CHART = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js';
const LEAF = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', LEAFCSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const COLORS = ['#ffc53d', '#5ee7ff', '#3ddc97', '#b69cff', '#ff8a6b', '#6aa8ff', '#ff6bb5', '#c8e66b', '#f5a35c', '#7ef0d0'];
let chartP, leafP; const charts = {};
const loadChart = () => chartP || (chartP = LE.load(CHART).catch(e => { chartP = null; throw e; }));
const loadLeaf = () => leafP || (leafP = LE.load(LEAF, LEAFCSS).catch(e => { leafP = null; throw e; }));

/* ---------- helpers ---------- */
const PER = {today: 'Today', '7d': '7 days', month: 'This month', '30d': '30 days'};
function range(per = st.q.per || 'today') {
  const t = today();
  return per === 'today' ? [t, t] : per === '7d' ? [LE.addDays(t, -6), t] : per === 'month' ? [t.slice(0, 8) + '01', t] : [LE.addDays(t, -29), t];
}
const people = () => [...S.users.values()].sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name));
const colorOf = uid => { const ids = people().map(u => u.uid); const i = ids.indexOf(uid); return COLORS[(i < 0 ? ids.length : i) % COLORS.length]; };
const inRange = (r, [f, t]) => r.date >= f && r.date <= t;
const repSel = (k = 'rep') => `<select data-sel="${k}"><option value="all">All salespeople</option>${people().map(u => `<option value="${u.uid}" ${st.q[k] === u.uid ? 'selected' : ''}>${esc(u.name)}${u.active ? '' : ' (inactive)'}</option>`).join('')}</select>`;
const byRep = (a, k = 'rep') => (!st.q[k] || st.q[k] === 'all') ? a : a.filter(r => r.ownerUid === st.q[k]);
const seg = (k, opts, def) => `<div class="seg">${Object.entries(opts).map(([v, l]) => `<button data-seg="${k}" data-v="${v}" class="${(st.q[k] || def) === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
function stats(recs) {
  const K = k => recs.filter(r => r.kind === k), q = K('quote');
  return {visits: K('visit').length, cust: new Set(K('visit').map(r => r.customerKey)).size, quotes: q.length, quoteVal: LE.sum(q, 'value'),
    orders: K('order').length, sales: LE.sum(K('order'), 'value'), collection: LE.sum(K('payment'), 'amount'),
    won: q.filter(x => x.status === 'won').length, lost: q.filter(x => x.status === 'lost').length};
}
function board(rg, month) {
  const recs = all().filter(r => inRange(r, rg)), ids = new Set([...people().filter(u => u.active && u.role !== 'admin').map(u => u.uid), ...recs.map(r => r.ownerUid)]);
  return [...ids].map(uid => {
    const u = S.users.get(uid) || {name: (recs.find(r => r.ownerUid === uid) || {}).ownerName || 'Unknown', uid};
    const s = stats(recs.filter(r => r.ownerUid === uid)), t = month && S.targets.get(`${uid}_${month}`);
    const last = all().filter(r => r.ownerUid === uid).sort((a, b) => b.ts - a.ts)[0];
    return {uid, u, s, t, last};
  }).sort((a, b) => b.s.sales - a.s.sales || b.s.collection - a.s.collection || b.s.visits - a.s.visits);
}
function sortable(rows, key, cols) {
  const s = st.q[key + 'S'] || cols[0][0], d = st.q[key + 'D'] || 'desc';
  rows.sort((a, b) => { const x = a[s], y = b[s]; const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? '')); return d === 'asc' ? c : -c; });
  return `<tr>${cols.map(([k, l, cls]) => `<th data-sort="${key}" data-k="${k}" class="${cls || ''}">${l}${s === k ? `<span class="arr">${d === 'asc' ? '▲' : '▼'}</span>` : ''}</th>`).join('')}</tr>`;
}
document.addEventListener('click', e => {
  const sg = e.target.closest('[data-seg]'); if (sg) { st.q[sg.dataset.seg] = sg.dataset.v; render(); return; }
  const th = e.target.closest('th[data-sort]'); if (th) { const k = th.dataset.sort; st.q[k + 'D'] = st.q[k + 'S'] === th.dataset.k && st.q[k + 'D'] !== 'asc' ? 'asc' : 'desc'; st.q[k + 'S'] = th.dataset.k; render(); }
});
const exportCSV = (recs, name) => LE.download(`le-sales-${name}-${today()}.csv`, LE.toCSV(recs.slice().sort((a, b) => a.ts - b.ts)), 'text/csv;charset=utf-8');

/* ---------- map (one persistent Leaflet instance moved between views) ---------- */
const pin = (c, label, ring) => L.divIcon({className: '', html: `<div class="pinm" style="background:${c}${ring ? ';box-shadow:0 0 0 3px ' + ring : ''}"><b>${label}</b></div>`, iconSize: [26, 26], iconAnchor: [13, 26], popupAnchor: [0, -24]});
const MapC = {el: null, map: null, layer: null, sig: '',
  async mount(slot, draw, sig) {
    try { await loadLeaf(); } catch { slot.innerHTML = '<div class="empty" style="margin:12px">Map needs internet to load.</div>'; return; }
    if (!this.el) {
      this.el = document.createElement('div'); this.el.style.cssText = 'width:100%;height:100%';
      this.map = L.map(this.el, {zoomControl: true, attributionControl: true}).setView([23.3441, 85.3096], 12);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(this.map);
      this.layer = L.layerGroup().addTo(this.map);
    }
    slot.innerHTML = ''; slot.appendChild(this.el); this.map.invalidateSize();
    this.layer.clearLayers();
    const pts = draw(this.layer) || [];
    if (sig !== this.sig) { this.sig = sig; if (pts.length) this.map.fitBounds(L.latLngBounds(pts).pad(0.25), {maxZoom: 15}); }
    setTimeout(() => this.map.invalidateSize(), 60);
  }};
function visitsLayer(pts) {
  return layer => {
    const reps = {};
    pts.slice().sort((a, b) => a.ts - b.ts).forEach(r => (reps[r.ownerUid] = reps[r.ownerUid] || []).push(r));
    Object.entries(reps).forEach(([uid, a]) => {
      const c = colorOf(uid);
      if (a.length > 1) L.polyline(a.map(r => [r.lat, r.lng]), {color: c, weight: 2.5, opacity: .7, dashArray: '6 6'}).addTo(layer);
      a.forEach((r, i) => L.marker([r.lat, r.lng], {icon: pin(c, i + 1)}).bindPopup(`<b>${esc(r.customer)}</b><br>${esc(r.ownerName || '')} · ${time(r.ts)}<br>${esc(r.requirement || r.ctype || '')}<br><a href="${LE.map(r.lat, r.lng)}" target="_blank" rel="noopener">Open in Google Maps</a>`).addTo(layer));
    });
    return pts.map(r => [r.lat, r.lng]);
  };
}
const fresh = ts => { const m = (Date.now() - ts) / 60000; return m < 5 ? ['#3ddc97', 'live', 'Live'] : m < 30 ? ['#ffc53d', 'recent', 'Recent'] : ['#77829a', 'old', 'Offline']; };
const kmOf = a => { let d = 0; for (let i = 1; i < a.length; i++) { const p = a[i - 1], q = a[i], R = 6371, r = x => x * Math.PI / 180, h = Math.sin(r(q.lat - p.lat) / 2) ** 2 + Math.cos(r(p.lat)) * Math.cos(r(q.lat)) * Math.sin(r(q.lng - p.lng) / 2) ** 2; d += 2 * R * Math.asin(Math.sqrt(h)); } return d; };
const legend = pts => { const u = [...new Set(pts.map(r => r.ownerUid))]; return u.length ? `<div class="legend">${u.map(id => `<span><i style="background:${colorOf(id)}"></i>${esc((S.users.get(id) || {}).name || '')} · ${pts.filter(r => r.ownerUid === id).length}</span>`).join('')}</div>` : ''; };

/* ---------- charts ---------- */
async function drawCharts(defs) {
  try { await loadChart(); } catch { defs.forEach(([id]) => { const c = document.getElementById(id); c && (c.parentElement.innerHTML = '<div class="empty">Charts need internet to load.</div>'); }); return; }
  Chart.defaults.color = '#a3adbf'; Chart.defaults.font.family = 'Inter, system-ui, sans-serif'; Chart.defaults.borderColor = 'rgba(255,255,255,.06)';
  defs.forEach(([id, cfg]) => { const c = document.getElementById(id); if (!c) return; charts[id] && charts[id].destroy(); cfg.options = Object.assign({responsive: true, maintainAspectRatio: false, animation: false}, cfg.options); charts[id] = new Chart(c, cfg); });
}
const inr = v => short(v);

/* ---------- dashboard ---------- */
V.dashboard = {mgr: true, title: 'Dashboard', render() {
  const rg = range(), recs = byRep(all().filter(r => inRange(r, rg))), s = stats(recs);
  const oq = byRep(openQuotes()), od = oq.filter(q => q.followUp && q.followUp < today()), due = byRep(dueQuotes()).filter(q => q.followUp <= today());
  const winR = s.won + s.lost ? Math.round(s.won / (s.won + s.lost) * 100) + '%' : '—';
  const m = LE.month(), lb = board(st.q.per === 'month' || st.q.per === '30d' ? rg : [m + '-01', today()], m).slice(0, 8);
  const feed = all().slice().sort((a, b) => b.upd - a.upd).slice(0, 9);
  const vpts = byRep(all().filter(r => r.kind === 'visit' && r.date === today() && r.lat != null));
  return `<div class="page-h"><div><h1>Sales dashboard</h1><p>${PER[st.q.per || 'today']} · ${nice(rg[0])}${rg[0] !== rg[1] ? ' – ' + nice(rg[1]) : ''} · updates live</p></div>
    <div class="toolbar">${seg('per', PER, 'today')}${repSel()}<button class="btn sm" id="dcsv">${icon('download')}CSV</button></div></div>
   <div class="kpis k6">
    ${kpi('green', 'box', short(s.sales), 'Orders (sales)', `${s.orders} order(s)`)}${kpi('violet', 'rupee', short(s.collection), 'Collections', `${recs.filter(r => r.kind === 'payment').length} collection(s)`)}
    ${kpi('cyan', 'pin', s.visits, 'Visits', `${s.cust} unique customer(s)`)}${kpi('amber', 'quote', short(s.quoteVal), 'New quotations', `${s.quotes} quote(s) · win rate ${winR}`)}
    ${kpi('blue', 'kanban', short(LE.sum(oq, 'value')), 'Open pipeline', `${oq.length} open quote(s)`)}${kpi(od.length ? 'red' : '', 'clock', od.length, 'Overdue follow-ups', `${due.length - od.length} due today`)}
   </div>
   <div class="dash two" style="margin-top:14px">
    <div class="card"><div class="card-h"><h3>Orders vs collections</h3><span class="sub">daily · ${rg[0] === rg[1] ? 'last 14 days' : PER[st.q.per]}</span></div><div class="chart"><canvas id="cTrend"></canvas></div></div>
    <div class="card"><div class="card-h"><h3>Pipeline by stage</h3><span class="sub">open + won/lost in window</span></div><div class="chart sm"><canvas id="cPipe"></canvas></div></div>
   </div>
   <div class="dash two" style="margin-top:14px">
    <div class="card pad0"><div class="card-h" style="padding:14px 16px 0"><h3>${icon('trophy')} Leaderboard</h3><a href="#/team" class="sub">Targets →</a></div>
     <div class="tbl-wrap"><table><thead><tr><th>#</th><th>Salesperson</th><th class="r">Visits</th><th class="r">Orders</th><th class="r">Collected</th><th>Sales target</th></tr></thead><tbody>
     ${lb.map((x, i) => `<tr><td><span class="rank ${i < 3 ? 'r' + (i + 1) : ''}">${i + 1}</span></td><td><div class="who"><span class="avatar sm" style="color:${colorOf(x.uid)}">${LE.initials(x.u.name)}</span><div><b>${esc(x.u.name)}</b><div class="pct">${esc(x.u.territory || '')}${x.last ? ' · ' + LE.ago(x.last.ts) : ''}</div></div></div></td>
       <td class="r">${x.s.visits}</td><td class="r amt">${short(x.s.sales)}</td><td class="r amt">${short(x.s.collection)}</td>
       <td style="min-width:120px">${x.t && x.t.sales ? `<div class="pct">${Math.round(x.s.sales / x.t.sales * 100)}% of ${short(x.t.sales)}</div>${pctBar(x.s.sales, x.t.sales)}` : '<span class="pct">not set</span>'}</td></tr>`).join('') || '<tr><td colspan="6"><div class="empty">No salespeople yet — add them in Team.</div></td></tr>'}
     </tbody></table></div></div>
    <div class="card pad0"><div class="card-h" style="padding:14px 16px 0"><h3>Live activity</h3><a href="#/activity" class="sub">All →</a></div><div class="list">${feed.map(r => li(r, {who: true})).join('') || '<div style="padding:14px"><div class="empty">Waiting for the first entry…</div></div>'}</div></div>
   </div>
   <div class="dash two" style="margin-top:14px">
    <div class="card"><div class="card-h"><h3>Today's visits</h3><a href="#/map" class="sub">Full map →</a></div><div class="mapbox" id="mapslot"></div>${legend(vpts)}</div>
    <div class="card pad0"><div class="card-h" style="padding:14px 16px 0"><h3>Follow-ups due</h3><a href="#/calendar" class="sub">Calendar →</a></div><div class="list">${due.slice(0, 7).map(q => fuItem(q, {who: true})).join('') || '<div style="padding:14px"><div class="empty">No follow-ups due 👍</div></div>'}</div></div>
   </div>`;
}, after(el) {
  const rg = range(), t1 = rg[1], t0 = rg[0] === rg[1] ? LE.addDays(t1, -13) : rg[0];
  const days = []; for (let d = t0; d <= t1; d = LE.addDays(d, 1)) days.push(d);
  const recs = byRep(all().filter(r => r.date >= t0 && r.date <= t1));
  const per = (k, f) => days.map(d => LE.sum(recs.filter(r => r.date === d && r.kind === k), f));
  const vis = days.map(d => recs.filter(r => r.date === d && r.kind === 'visit').length);
  const qs = byRep([...new Map([...openQuotes(), ...all().filter(r => r.kind === 'quote')].map(q => [q.id, q])).values()].filter(q => !q.deleted));
  const pv = LE.STATUS.map(s => LE.sum(qs.filter(q => q.status === s), 'value'));
  drawCharts([
    ['cTrend', {type: 'bar', data: {labels: days.map(nice), datasets: [
      {label: 'Orders', data: per('order', 'value'), backgroundColor: 'rgba(61,220,151,.75)', borderRadius: 5, yAxisID: 'y'},
      {label: 'Collections', data: per('payment', 'amount'), backgroundColor: 'rgba(182,156,255,.75)', borderRadius: 5, yAxisID: 'y'},
      {label: 'Visits', type: 'line', data: vis, borderColor: '#5ee7ff', backgroundColor: '#5ee7ff', tension: .35, pointRadius: 2.5, yAxisID: 'y1'}]},
      options: {interaction: {mode: 'index', intersect: false}, plugins: {legend: {position: 'bottom', labels: {boxWidth: 10, boxHeight: 10}}, tooltip: {callbacks: {label: c => c.dataset.label + ': ' + (c.dataset.yAxisID === 'y1' ? c.raw : money(c.raw))}}},
        scales: {y: {ticks: {callback: inr}, grid: {color: 'rgba(255,255,255,.05)'}}, y1: {position: 'right', grid: {display: false}, ticks: {precision: 0}}, x: {grid: {display: false}}}}}],
    ['cPipe', {type: 'doughnut', data: {labels: ['Hot', 'Warm', 'Cold', 'Won', 'Lost'], datasets: [{data: pv, backgroundColor: ['#ff6b6b', '#ffc53d', '#6aa8ff', '#3ddc97', '#4b5466'], borderColor: '#111620', borderWidth: 3}]},
      options: {cutout: '66%', plugins: {legend: {position: 'right', labels: {boxWidth: 10, boxHeight: 10, generateLabels: ch => ch.data.labels.map((l, i) => ({text: `${l}  ${short(pv[i])}`, fillStyle: ch.data.datasets[0].backgroundColor[i], strokeStyle: 'transparent', index: i, fontColor: '#a3adbf'}))}}, tooltip: {callbacks: {label: c => c.label + ': ' + money(c.raw)}}}}}],
  ]);
  { const vp = byRep(all().filter(r => r.kind === 'visit' && r.date === today() && r.lat != null)); MapC.mount($('#mapslot'), visitsLayer(vp), 'dash' + vp.map(r => r.id).join()); }
  $('#dcsv').onclick = () => exportCSV(byRep(all().filter(r => inRange(r, range()))), 'dashboard');
}};

/* ---------- live activity ---------- */
V.activity = {mgr: true, title: 'Live activity', render() {
  const k = st.q.ak || 'all', a = byRep(all()).filter(r => k === 'all' || r.kind === k).sort((x, y) => (y.upd || y.ts) - (x.upd || x.ts)).slice(0, 200);
  const groups = []; a.forEach(r => { const g = groups[groups.length - 1]; if (!g || g.d !== r.date) groups.push({d: r.date, items: [r]}); else g.items.push(r); });
  return `<div class="page-h"><div><h1>Live activity</h1><p>Every visit, quote, order and collection as it is saved · <span class="sync live" style="padding:2px 8px"><i></i>real time</span></p></div><div class="toolbar">${repSel()}</div></div>
   <div class="chips scroll" style="margin-bottom:12px">${[['all', 'All'], ['visit', 'Visits'], ['quote', 'Quotations'], ['order', 'Orders'], ['payment', 'Collections']].map(([v, l]) => `<button class="chip ${k === v ? 'on' : ''}" data-seg="ak" data-v="${v}">${l}</button>`).join('')}</div>
   ${groups.map(g => `<div class="card-h" style="margin:14px 2px 8px"><h3>${g.d === today() ? 'Today' : niceLong(g.d)}</h3><span class="sub">${g.items.length}</span></div>${listCard(g.items.map(r => li(r, {who: true})), '')}`).join('') || '<div class="empty">No activity yet</div>'}`;
}};

/* ---------- map: visits / live positions / route replay ---------- */
let routeCache = {key: '', pts: null, at: 0};
// default route person: explicit pick, else whoever reported a location most recently, else first salesperson
function routeUid(sales) {
  if (st.q.ru && S.users.has(st.q.ru)) return st.q.ru;
  const live = sales.filter(u => S.lastLoc.has(u.uid)).sort((a, b) => S.lastLoc.get(b.uid).ts - S.lastLoc.get(a.uid).ts);
  return ((live[0] || sales[0]) || {}).uid;
}
V.map = {mgr: true, title: 'Map', render() {
  const mode = st.q.mm || 'live', d = st.q.md || today();
  const modes = seg('mm', {live: 'Live', route: 'Route', visits: 'Visits'}, 'live');
  const dateIn = `<input type="date" data-sel="md" value="${d}" max="${today()}" style="width:auto;min-height:38px;margin:0;font-size:14px;padding:6px 10px">`;
  if (mode === 'live') {
    const sales = people().filter(u => u.active && u.role === 'sales');
    const rows = sales.map(u => ({u, l: S.lastLoc.get(u.uid)})).sort((a, b) => ((b.l || {}).ts || 0) - ((a.l || {}).ts || 0));
    const nLive = rows.filter(x => x.l && fresh(x.l.ts)[1] === 'live').length;
    return `<div class="page-h"><div><h1>Live locations</h1><p>${nLive} of ${sales.length} salespeople live now · updates every ~3 min all day from the Android app after Start day (web: every ~2 min while open)</p></div><div class="toolbar">${modes}</div></div>
     <div class="dash two"><div class="card"><div class="mapbox tall" id="mapslot"></div>
      <div class="legend"><span><i style="background:#3ddc97"></i>seen &lt; 5 min</span><span><i style="background:#ffc53d"></i>&lt; 30 min</span><span><i style="background:#77829a"></i>older</span></div></div>
      <div class="card pad0"><div class="card-h" style="padding:14px 16px 0"><h3>Salespeople</h3><span class="sub">last seen</span></div><div class="list">
      ${rows.map(({u, l}) => { const f = l ? fresh(l.ts) : ['#77829a', 'old', 'No location yet'];
        return `<div class="li"><span class="avatar sm" style="box-shadow:0 0 0 2px ${f[0]};color:${colorOf(u.uid)}">${LE.initials(u.name)}</span><div class="b"><div class="t"><span>${esc(u.name)}</span><span class="tag" style="color:${f[0]};background:rgba(255,255,255,.06)">${l ? f[2] : '—'}</span></div>
         <div class="m">${l ? `<span>${LE.ago(l.ts)} · ${time(l.ts)}</span><span>· ±${l.accuracy}m</span>${l.battery != null ? `<span>· 🔋${Math.round(l.battery * 100)}%${l.charging ? '⚡' : ''}</span>` : ''}<span>· ${esc(l.source)}</span><a href="${LE.map(l.lat, l.lng)}" target="_blank" rel="noopener">map</a><a href="#" data-route="${u.uid}">route</a>` : '<span>Not shared yet (app not opened or location off)</span>'}</div></div></div>`; }).join('') || '<div style="padding:14px"><div class="empty">No active salespeople</div></div>'}</div></div></div>`;
  }
  if (mode === 'route') {
    const sales = people().filter(u => u.role === 'sales'), uid = routeUid(sales);
    const key = uid + '|' + d, pts = routeCache.key === key ? routeCache.pts : null;
    const vis = all().filter(r => r.kind === 'visit' && r.ownerUid === uid && r.date === d && r.lat != null).sort((a, b) => a.ts - b.ts);
    const sel = `<select data-sel="ru" style="width:auto;min-height:38px;margin:0">${sales.map(u => `<option value="${u.uid}" ${u.uid === uid ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>`;
    const info = !uid ? 'No salespeople yet' : !pts ? 'Loading route…' : pts.length ? `${pts.length} points · ${kmOf(pts).toFixed(1)} km · ${time(pts[0].ts)} – ${time(pts[pts.length - 1].ts)} · ${vis.length} check-in(s)` : `No tracked points for this day · ${vis.length} check-in(s)`;
    return `<div class="page-h"><div><h1>Route replay</h1><p>${info}</p></div><div class="toolbar">${modes}${sel}${dateIn}<button class="btn sm" id="rref">Refresh</button></div></div>
     <div class="card"><div class="mapbox tall" id="mapslot"></div><div class="legend"><span><i style="background:#3ddc97"></i>start</span><span><i style="background:#ff6b6b"></i>end / last</span><span><i style="background:${uid ? colorOf(uid) : '#fff'}"></i>numbered = customer check-ins</span><span>dotted = tracked path</span></div></div>`;
  }
  const pts = byRep(all().filter(r => r.kind === 'visit' && r.date === d && r.lat != null)), nog = byRep(all().filter(r => r.kind === 'visit' && r.date === d && r.lat == null));
  return `<div class="page-h"><div><h1>Visits map</h1><p>${niceLong(d)} · ${pts.length} GPS check-in(s)${nog.length ? ` · ${nog.length} without GPS` : ''} · numbered in visit order</p></div>
    <div class="toolbar">${modes}${dateIn}${repSel()}</div></div>
   <div class="card"><div class="mapbox tall" id="mapslot"></div>${legend(pts)}</div>`;
}, after(el) {
  const mode = st.q.mm || 'live', d = st.q.md || today(), slot = $('#mapslot');
  $$('[data-route]', el).forEach(a => a.onclick = e => { e.preventDefault(); st.q.mm = 'route'; st.q.ru = a.dataset.route; st.q.md = today(); render(); });
  if (mode === 'live') {
    const rows = people().filter(u => u.active && u.role === 'sales').map(u => ({u, l: S.lastLoc.get(u.uid)})).filter(x => x.l);
    MapC.mount(slot, layer => { rows.forEach(({u, l}) => { const f = fresh(l.ts);
      if (l.accuracy > 30 && l.accuracy < 2000) L.circle([l.lat, l.lng], {radius: l.accuracy, color: f[0], weight: 1, opacity: .4, fillOpacity: .06}).addTo(layer);
      L.marker([l.lat, l.lng], {icon: pin(colorOf(u.uid), LE.initials(u.name), f[0])}).bindPopup(`<b>${esc(u.name)}</b><br>${f[2]} · ${LE.ago(l.ts)} (${time(l.ts)})<br>±${l.accuracy} m${l.battery != null ? ' · battery ' + Math.round(l.battery * 100) + '%' : ''}<br><a href="${LE.map(l.lat, l.lng)}" target="_blank" rel="noopener">Open in Google Maps</a>`).addTo(layer); });
      return rows.map(x => [x.l.lat, x.l.lng]); }, 'live' + rows.map(x => x.u.uid).join());
    clearTimeout(V.map._t); V.map._t = setTimeout(() => { if ((location.hash.split('/')[1] || '') === 'map' && (st.q.mm || 'live') === 'live' && !document.getElementById('modal')) render(); }, 30000);
    return;
  }
  if (mode === 'route') {
    const sales = people().filter(u => u.role === 'sales'), uid = routeUid(sales); if (!uid) return;
    const key = uid + '|' + d;
    const load = () => DB.routeFor(uid, d).then(pts => { routeCache = {key, pts, at: Date.now()}; render(); }).catch(e => { routeCache = {key, pts: [], at: Date.now()}; LE.toast(LE.errMsg(e)); render(); });
    $('#rref').onclick = load;
    if (routeCache.key !== key) { load(); }
    const pts = routeCache.key === key && routeCache.pts || [], vis = all().filter(r => r.kind === 'visit' && r.ownerUid === uid && r.date === d && r.lat != null).sort((a, b) => a.ts - b.ts), c = colorOf(uid);
    MapC.mount(slot, layer => {
      if (pts.length > 1) L.polyline(pts.map(p => [p.lat, p.lng]), {color: c, weight: 3, opacity: .8, dashArray: '4 6'}).addTo(layer);
      pts.forEach((p, i) => { if (i && i < pts.length - 1) L.circleMarker([p.lat, p.lng], {radius: 3, color: c, weight: 1, fillOpacity: .9}).bindTooltip(time(p.ts)).addTo(layer); });
      if (pts.length) { L.marker([pts[0].lat, pts[0].lng], {icon: pin('#3ddc97', 'S')}).bindPopup('Start ' + time(pts[0].ts)).addTo(layer); const z = pts[pts.length - 1]; L.marker([z.lat, z.lng], {icon: pin('#ff6b6b', 'E')}).bindPopup((d === today() ? 'Last seen ' : 'End ') + time(z.ts)).addTo(layer); }
      vis.forEach((r, i) => L.marker([r.lat, r.lng], {icon: pin(c, i + 1)}).bindPopup(`<b>${esc(r.customer)}</b><br>Check-in ${time(r.ts)}<br>${esc(r.requirement || '')}`).addTo(layer));
      return [...pts.map(p => [p.lat, p.lng]), ...vis.map(r => [r.lat, r.lng])];
    }, 'route' + key + pts.length);
    return;
  }
  const pts = byRep(all().filter(r => r.kind === 'visit' && r.date === d && r.lat != null)); MapC.mount(slot, visitsLayer(pts), 'visits' + d + pts.map(r => r.id).join());
}};

/* ---------- pipeline kanban ---------- */
V.pipeline = {mgr: true, title: 'Pipeline', render() {
  const from = LE.addDays(today(), -30), qs = byRep([...new Map([...openQuotes(), ...all().filter(r => r.kind === 'quote')].map(q => [q.id, q])).values()].filter(q => !q.deleted && (LE.isOpen(q) || (q.date >= from || (q.upd && LE.dstr(q.upd) >= from)))));
  const canEdit = q => DB.isAdmin() || q.ownerUid === S.user.uid;
  const col = s => { const a = qs.filter(q => q.status === s).sort((x, y) => (y.value || 0) - (x.value || 0)); return `<div class="kcol" data-col="${s}"><div class="kcol-h"><span><span class="tag ${s}">${s}</span> <span class="dim">${a.length}</span></span><span class="amt">${short(LE.sum(a, 'value'))}</span></div>
    ${a.map(q => `<div class="kcard" draggable="${canEdit(q)}" data-q="${q.id}"><div class="t"><span>${esc(q.customer)}</span><span class="amt">${short(q.value)}</span></div>
     <div class="m"><span>${esc(q.ownerName || '')}</span>${q.followUp ? `<span class="${q.followUp < today() && LE.isOpen(q) ? 'tag overdue' : ''}">${q.followUp < today() && LE.isOpen(q) ? 'overdue ' : '↻ '}${nice(q.followUp)}</span>` : ''}${q.expected ? `<span>exp. ${nice(q.expected)}</span>` : ''}</div>
     ${canEdit(q) ? `<select data-move="${q.id}">${LE.STATUS.map(x => `<option value="${x}" ${x === s ? 'selected' : ''}>Move to: ${x}</option>`).join('')}</select>` : ''}</div>`).join('') || '<div class="empty" style="padding:14px">—</div>'}</div>`; };
  const open = qs.filter(LE.isOpen), won = qs.filter(q => q.status === 'won'), lost = qs.filter(q => q.status === 'lost');
  return `<div class="page-h"><div><h1>Quotation pipeline</h1><p>Open ${short(LE.sum(open, 'value'))} · won ${short(LE.sum(won, 'value'))} · lost ${short(LE.sum(lost, 'value'))} (30 days)${DB.isAdmin() ? ' · drag cards or use “Move to”' : ' · view only (admin can move others’ quotes)'}</p></div><div class="toolbar">${repSel()}</div></div>
   <div class="kanban">${LE.STATUS.map(col).join('')}</div>`;
}, after(el) {
  $$('[data-move]', el).forEach(s => s.onchange = () => setStatus(s.dataset.move, s.value));
  $$('.kcard[draggable=true]', el).forEach(c => c.ondragstart = e => e.dataTransfer.setData('text/plain', c.dataset.q));
  $$('.kcol', el).forEach(c => { c.ondragover = e => { e.preventDefault(); c.classList.add('drop'); }; c.ondragleave = () => c.classList.remove('drop');
    c.ondrop = e => { e.preventDefault(); c.classList.remove('drop'); const id = e.dataTransfer.getData('text/plain'); if (id) setStatus(id, c.dataset.col); }; });
  $$('.kcard', el).forEach(c => c.ondblclick = () => { const q = S.records.get(c.dataset.q) || S.openQ.get(c.dataset.q); q && UI.form('quote', q); });
}};

/* ---------- follow-up calendar ---------- */
V.calendar = {mgr: true, title: 'Follow-ups', render() {
  const m = st.q.calm || LE.month(), first = new Date(m + '-01T12:00:00'), startDow = (first.getDay() + 6) % 7;
  const qs = byRep(dueQuotes()), by = {}; qs.forEach(q => (by[q.followUp] = by[q.followUp] || []).push(q));
  const cells = []; for (let i = 0; i < 42; i++) { const d = LE.addDays(m + '-01', i - startDow); cells.push(d); }
  const sel = st.q.cald || today(), list = by[sel] || [], od = qs.filter(q => q.followUp < today());
  const prev = LE.month(LE.addDays(m + '-01', -1)), next = LE.month(LE.addDays(m + '-01', 32));
  return `<div class="page-h"><div><h1>Follow-up calendar</h1><p>${qs.length} open follow-ups · <span style="color:var(--red)">${od.length} overdue (${short(LE.sum(od, 'value'))})</span></p></div>
    <div class="toolbar"><button class="btn sm" data-seg="calm" data-v="${prev}">‹</button><b style="min-width:130px;text-align:center">${LE.monthName(m)}</b><button class="btn sm" data-seg="calm" data-v="${next}">›</button>${repSel()}</div></div>
   <div class="dash two"><div class="card"><div class="cal">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="dow">${d}</div>`).join('')}
    ${cells.map(d => { const a = by[d] || []; return `<div class="d ${d.slice(0, 7) !== m ? 'out' : ''} ${d === today() ? 'today' : ''} ${d === sel ? 'sel' : ''}" data-seg="cald" data-v="${d}"><span>${+d.slice(8)}</span>${a.length ? `<span class="c ${d < today() ? 'od' : ''}">${a.length} · ${short(LE.sum(a, 'value'))}</span>` : ''}</div>`; }).join('')}</div></div>
    <div><div class="card-h" style="margin:2px 2px 8px"><h3>${sel === today() ? 'Today' : niceLong(sel)}</h3><span class="sub">${list.length} follow-up(s)</span></div>${listCard(list.map(q => fuItem(q, {who: true})), 'Nothing scheduled')}
     ${od.length && sel !== 'x' ? `<div class="card-h" style="margin:16px 2px 8px"><h3 style="color:var(--red)">All overdue</h3><span class="sub">${od.length}</span></div>${listCard(od.slice(0, 30).map(q => fuItem(q, {who: true})), '')}` : ''}</div></div>`;
}};

/* ---------- records table ---------- */
V.records = {mgr: true, title: 'All records', render() {
  const from = st.q.rf || LE.addDays(today(), -29), to = st.q.rt || today(), k = st.q.rk || 'all', q = (st.q.rs || '').toLowerCase();
  const rows = byRep(all()).filter(r => r.date >= from && r.date <= to && (k === 'all' || r.kind === k) && (!q || [r.customer, r.ownerName, r.requirement, r.items, r.note, r.ref, r.phone].join(' ').toLowerCase().includes(q)))
    .map(r => ({...r, amt: r.kind === 'payment' ? r.amount : r.value ?? null, det: r.kind === 'visit' ? (r.requirement || r.ctype || '') : r.kind === 'quote' ? r.status + (r.followUp ? ' · ↻ ' + nice(r.followUp) : '') : r.kind === 'order' ? (r.items || '') : [r.mode, r.ref].filter(Boolean).join(' · '), when: r.date + ' ' + String(r.ts).padStart(15, '0')}));
  st.recRows = rows;
  const head = sortable(rows, 'rec', [['when', 'Date'], ['kind', 'Type'], ['customer', 'Customer'], ['ownerName', 'Salesperson'], ['det', 'Details'], ['amt', 'Amount', 'r']]);
  return `<div class="page-h"><div><h1>All records</h1><p>${rows.length} entries · ${money(LE.sum(rows.filter(r => r.kind === 'order'), 'value'))} orders · ${money(LE.sum(rows.filter(r => r.kind === 'payment'), 'amount'))} collected</p></div><button class="btn" id="rcsv">${icon('download')}Export CSV</button></div>
   <div class="card pad0"><div class="tbl-tools"><div class="search">${icon('search')}<input data-keep="rs" data-q="rs" placeholder="Search customer, salesperson, notes…" value="${esc(st.q.rs || '')}"></div>
    <select data-sel="rk" style="width:auto;min-height:40px;margin:0">${[['all', 'All types'], ['visit', 'Visits'], ['quote', 'Quotations'], ['order', 'Orders'], ['payment', 'Collections']].map(([v, l]) => `<option value="${v}" ${k === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    ${repSel().replace('<select', '<select style="width:auto;min-height:40px;margin:0"')}
    <input type="date" data-sel="rf" value="${from}" style="width:auto;min-height:40px;margin:0;font-size:14px"><input type="date" data-sel="rt" value="${to}" style="width:auto;min-height:40px;margin:0;font-size:14px"></div>
   <div class="tbl-wrap"><table><thead>${head}</thead><tbody>${rows.slice(0, 500).map(r => `<tr class="tap" data-open="${r.id}" style="cursor:pointer"><td class="nowrap">${nice(r.date)} <span class="dim">${time(r.ts)}</span></td><td><span class="tag ${r.kind}">${LE.KINDS[r.kind]}</span></td><td><b>${esc(r.customer)}</b></td><td>${esc(r.ownerName || '')}</td><td class="mut" style="max-width:320px">${esc(r.det)}${r.kind === 'visit' && r.lat != null ? ` · <a href="${LE.map(r.lat, r.lng)}" target="_blank" rel="noopener">map</a>` : ''}</td><td class="r amt">${r.amt != null ? money(r.amt) : ''}</td></tr>`).join('') || '<tr><td colspan="6"><div class="empty">No records match</div></td></tr>'}</tbody></table></div>
   ${rows.length > 500 ? '<p class="note" style="padding:0 14px 12px">Showing first 500 — narrow the filters or export CSV for all.</p>' : ''}</div>`;
}, after() { $('#rcsv').onclick = () => exportCSV(st.recRows || [], 'records'); }};

/* ---------- team: leaderboard, targets, employees ---------- */
V.team = {mgr: true, title: 'Team & targets', render() {
  const tab = st.q.tt || 'board', m = st.q.tm || LE.month(), months = [0, 1, 2].map(i => LE.month(LE.addDays(LE.month() + '-15', -31 * i)));
  const mEnd = m === LE.month() ? today() : LE.addDays(LE.month(LE.addDays(m + '-28', 5)) + '-01', -1);
  const lb = board([m + '-01', mEnd], m);
  const monthSel = `<select data-sel="tm" style="width:auto;min-height:38px;margin:0">${months.map(x => `<option value="${x}" ${x === m ? 'selected' : ''}>${LE.monthName(x)}</option>`).join('')}</select>`;
  let body = '';
  if (tab === 'board') {
    const rows = lb.map(x => ({uid: x.uid, name: x.u.name, terr: x.u.territory || '', visits: x.s.visits, quotes: x.s.quoteVal, sales: x.s.sales, coll: x.s.collection, won: x.s.won,
      sp: x.t && x.t.sales ? x.s.sales / x.t.sales : -1, cp: x.t && x.t.collection ? x.s.collection / x.t.collection : -1, vp: x.t && x.t.visits ? x.s.visits / x.t.visits : -1, t: x.t, s: x.s}));
    const head = sortable(rows, 'lb', [['sales', 'Orders', 'r'], ['name', 'Salesperson'], ['visits', 'Visits', 'r'], ['quotes', 'Quoted', 'r'], ['coll', 'Collected', 'r'], ['sp', 'Sales vs target'], ['cp', 'Collection vs target'], ['vp', 'Visits vs target']]);
    const pc = (a, t, cls) => t ? `<div class="pct">${Math.round(a / t * 100)}% · ${typeof a === 'number' && t > 999 ? short(a) + ' / ' + short(t) : a + ' / ' + t}</div>${pctBar(a, t, cls)}` : '<span class="pct">—</span>';
    body = `<div class="card pad0"><div class="tbl-wrap"><table><thead>${head.replace('<tr>', '<tr><th>#</th>')}</thead><tbody>${rows.map((x, i) => `<tr><td><span class="rank ${i < 3 ? 'r' + (i + 1) : ''}">${i + 1}</span></td><td class="r amt">${short(x.sales)}</td>
      <td><div class="who"><span class="avatar sm" style="color:${colorOf(x.uid)}">${LE.initials(x.name)}</span><div><b>${esc(x.name)}</b><div class="pct">${esc(x.terr)}</div></div></div></td>
      <td class="r">${x.visits}</td><td class="r amt">${short(x.quotes)}</td><td class="r amt">${short(x.coll)}</td>
      <td style="min-width:130px">${pc(x.s.sales, x.t && x.t.sales)}</td><td style="min-width:130px">${pc(x.s.collection, x.t && x.t.collection, 'g')}</td><td style="min-width:110px">${pc(x.s.visits, x.t && x.t.visits, 'c')}</td></tr>`).join('') || '<tr><td colspan="9"><div class="empty">No salespeople yet</div></td></tr>'}</tbody></table></div></div>`;
  } else if (tab === 'targets') {
    const emps = people().filter(u => u.active && u.role !== 'admin');
    body = `<div class="card pad0"><div class="tbl-wrap"><table><thead><tr><th>Salesperson</th><th>Sales target ₹</th><th>Collection target ₹</th><th>Visits target</th><th>Achieved (sales / coll / visits)</th>${DB.isAdmin() ? '<th></th>' : ''}</tr></thead><tbody>
      ${emps.map(u => { const t = S.targets.get(`${u.uid}_${m}`) || {}, x = lb.find(y => y.uid === u.uid) || {s: {sales: 0, collection: 0, visits: 0}}, dis = DB.isAdmin() ? '' : 'disabled';
        return `<tr data-trow="${u.uid}"><td><b>${esc(u.name)}</b><div class="pct">${esc(u.territory || '')}</div></td>
        <td><input name="sales" type="number" min="0" value="${t.sales ?? ''}" ${dis} style="min-height:40px;margin:0;width:150px"></td><td><input name="collection" type="number" min="0" value="${t.collection ?? ''}" ${dis} style="min-height:40px;margin:0;width:150px"></td>
        <td><input name="visits" type="number" min="0" value="${t.visits ?? ''}" ${dis} style="min-height:40px;margin:0;width:100px"></td>
        <td class="pct">${short(x.s.sales)} / ${short(x.s.collection)} / ${x.s.visits}</td>${DB.isAdmin() ? `<td><button class="btn sm pri" data-tsave="${u.uid}">Save</button></td>` : ''}</tr>`; }).join('') || '<tr><td colspan="6"><div class="empty">Add employees first</div></td></tr>'}</tbody></table></div></div>
      <p class="note">${DB.isAdmin() ? 'Targets are per employee per month. Leaderboard and each salesperson’s Today screen show progress.' : 'Only the admin can change targets.'}</p>`;
  } else {
    const q = (st.q.es || '').toLowerCase(), emps = people().filter(u => !q || [u.name, u.email, u.phone, u.territory].join(' ').toLowerCase().includes(q));
    body = `<div class="card pad0"><div class="tbl-tools"><div class="search">${icon('search')}<input data-keep="es" data-q="es" placeholder="Search employees" value="${esc(st.q.es || '')}"></div>${DB.isAdmin() ? `<button class="btn pri" id="addEmp">${icon('plus')}Add employee</button>` : ''}</div>
     <div class="tbl-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Territory</th><th>Status</th>${DB.isAdmin() ? '<th></th>' : ''}</tr></thead><tbody>
     ${emps.map(u => `<tr><td><div class="who"><span class="avatar sm" style="color:${colorOf(u.uid)}">${LE.initials(u.name)}</span><b>${esc(u.name)}</b></div></td><td class="mut">${esc(u.email)}</td><td class="mut">${esc(u.phone || '')}</td><td><span class="tag ${u.role}">${u.role}</span></td><td>${esc(u.territory || '')}</td>
       <td><span class="tag ${u.active ? 'on' : 'off'}">${u.active ? 'Active' : 'Inactive'}</span>${u.mustChangePassword ? ' <span class="pct">temp password</span>' : ''}</td>
       ${DB.isAdmin() ? `<td class="nowrap">${u.uid === S.user.uid ? '<span class="pct">you</span>' : `<button class="btn sm" data-eedit="${u.uid}">Edit</button> <button class="btn sm" data-ereset="${u.uid}">Reset password</button> <button class="btn sm ${u.active ? 'danger' : ''}" data-etoggle="${u.uid}">${u.active ? 'Deactivate' : 'Activate'}</button>`}</td>` : ''}</tr>`).join('')}
     </tbody></table></div></div><p class="note">Only the admin can add or deactivate employees. Deactivated users are blocked immediately, even on phones already signed in. ${people().filter(u => u.active).length} active.</p>`;
  }
  return `<div class="page-h"><div><h1>Team & targets</h1><p>${people().filter(u => u.active && u.role !== 'admin').length} active salespeople/managers · ${LE.monthName(m)}</p></div>
    <div class="toolbar">${seg('tt', {board: 'Leaderboard', targets: 'Targets', emp: 'Employees'}, 'board')}${tab !== 'emp' ? monthSel : ''}</div></div>${body}`;
}, after(el) {
  const m = st.q.tm || LE.month();
  $$('[data-tsave]', el).forEach(b => b.onclick = async () => { const row = b.closest('tr'), v = n => row.querySelector(`[name=${n}]`).value;
    b.disabled = true; try { await DB.setTarget(b.dataset.tsave, m, {sales: v('sales'), collection: v('collection'), visits: v('visits')}); LE.toast('Target saved'); } catch (e) { LE.toast(LE.errMsg(e)); } b.disabled = false; });
  $('#addEmp') && ($('#addEmp').onclick = () => empForm());
  $$('[data-eedit]', el).forEach(b => b.onclick = () => empForm(S.users.get(b.dataset.eedit)));
  $$('[data-ereset]', el).forEach(b => b.onclick = async () => { const u = S.users.get(b.dataset.ereset); if (!confirm(`Send a password reset email to ${u.email}?`)) return; try { await DB.resetPw(u.email); LE.toast('Reset email sent to ' + u.email); } catch (e) { LE.toast(LE.errMsg(e)); } });
  $$('[data-etoggle]', el).forEach(b => b.onclick = async () => { const u = S.users.get(b.dataset.etoggle); if (!confirm(`${u.active ? 'Deactivate' : 'Activate'} ${u.name}?${u.active ? ' They will be blocked immediately.' : ''}`)) return;
    try { await DB.updateUser(u.uid, {active: !u.active}); LE.toast(u.active ? 'Deactivated' : 'Activated'); } catch (e) { LE.toast(LE.errMsg(e)); } });
}};
function genPw() { const c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'; let s = ''; const a = crypto.getRandomValues(new Uint32Array(10)); a.forEach(x => s += c[x % c.length]); return 'Le-' + s; }
function empForm(u) {
  const edit = !!u;
  modal(`<form id="ef">${mh(edit ? 'Edit employee' : 'Add employee')}<p class="note">${edit ? esc(u.email) : 'Creates their login. Share the email and temporary password with them — they must set their own password at first sign-in.'}</p>
    <label class="f">Full name *<input name="name" required value="${esc(edit ? u.name : '')}"></label>
    ${edit ? '' : '<label class="f">Email (login) *<input name="email" type="email" required autocomplete="off"></label>'}
    <div class="row2"><label class="f">Phone<input name="phone" inputmode="tel" value="${esc(edit ? u.phone || '' : '')}"></label><label class="f">Territory<input name="territory" value="${esc(edit ? u.territory || '' : '')}" placeholder="e.g. Ranchi North"></label></div>
    <label class="f">Role<select name="role">${['sales', 'manager'].map(r => `<option value="${r}" ${edit && u.role === r ? 'selected' : ''}>${LE.ROLES[r]}</option>`).join('')}${edit && u.role === 'admin' ? '<option value="admin" selected>Admin</option>' : ''}</select></label>
    ${edit ? '' : `<label class="f">Temporary password *<input name="password" required minlength="8" value="${genPw()}" autocomplete="off"></label>`}
    <div id="efm"></div><div class="modal-f"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn pri">${edit ? 'Save' : 'Create login'}</button></div></form>`);
  $('#ef').onsubmit = async e => {
    e.preventDefault(); const f = e.target, d = Object.fromEntries(new FormData(f)), btn = f.querySelector('.btn.pri'); btn.disabled = true; btn.textContent = 'Please wait…';
    try {
      if (edit) { await DB.updateUser(u.uid, {name: d.name.trim(), phone: d.phone.trim(), territory: d.territory.trim(), role: d.role}); closeModal(); LE.toast('Saved'); return; }
      await DB.createEmployee(d);
      const msg = `Hello ${d.name.split(' ')[0]}, your LE Sales login:\n${location.origin + location.pathname}\nEmail: ${d.email.trim().toLowerCase()}\nTemporary password: ${d.password}\nYou will be asked to set your own password.`;
      const ph = (d.phone || '').replace(/\D/g, '');
      modal(`${mh('Employee added')}<div class="ok">${esc(d.name)} can now sign in.</div><pre class="report">${esc(msg)}</pre>
        <div class="modal-f"><button class="btn" id="cpy">Copy</button>${ph ? `<a class="btn wa" target="_blank" rel="noopener" href="https://wa.me/${ph.length === 10 ? '91' + ph : ph}?text=${encodeURIComponent(msg)}">${icon('wa')}Share on WhatsApp</a>` : '<button class="btn pri" data-close>Done</button>'}</div>`);
      $('#cpy').onclick = () => navigator.clipboard?.writeText(msg).then(() => LE.toast('Copied'));
    } catch (er) { btn.disabled = false; btn.textContent = edit ? 'Save' : 'Create login'; $('#efm').innerHTML = `<div class="err">${esc(er.code === 'auth/email-already-in-use' ? 'This email already has a login. Use a different email, or remove the old login in Firebase console → Authentication.' : LE.errMsg(er))}</div>`; }
  };
}
})();
