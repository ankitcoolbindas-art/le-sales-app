/* LE Sales v2 — app shell, router, auth screens, entry forms, salesperson views */
const UI = (() => {
const {esc, money, short, today, nice, niceLong, time, map} = LE;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const S = DB.S;
const V = {};            // view registry
const st = {authMode: 'login', authMsg: '', authErr: '', q: {}, seen: null, fresh: new Set(), route: '', shellFor: ''};
const root = document.getElementById('root');
const BOLT = '<svg viewBox="0 0 24 24"><path d="M13.5 2 4 14h6.5L9.5 22 20 9.5h-6.6z" fill="#ffc53d"/></svg>';
const brand = sub => `<div class="brand"><span class="mark">${BOLT}</span><span><b>LE Sales</b><small>${sub || 'Lalit Enterprises · Ranchi'}</small></span></div>`;

/* ---------- data helpers ---------- */
const all = () => [...S.records.values()].filter(r => !r.deleted);
const mine = () => all().filter(r => r.ownerUid === (S.user && S.user.uid));
const scope = () => DB.isMgr() ? all() : mine();
function openQuotes(own) {
  const m = new Map(S.openQ);
  S.records.forEach(r => { if (r.kind === 'quote') m.set(r.id, r); });
  return [...m.values()].filter(LE.isOpen).filter(q => !own || q.ownerUid === S.user.uid);
}
const dueQuotes = own => openQuotes(own).filter(q => q.followUp).sort((a, b) => a.followUp.localeCompare(b.followUp));
function customers(list = scope()) {
  const m = new Map();
  list.slice().sort((a, b) => a.ts - b.ts).forEach(r => {
    if (!r.customerKey) return;
    const c = m.get(r.customerKey) || {key: r.customerKey, name: r.customer, visits: 0, orders: 0, collected: 0, quotes: 0, last: 0, reps: new Set()};
    c.name = r.customer; c.last = Math.max(c.last, r.ts); c.reps.add(r.ownerName || '');
    ['ctype', 'phone', 'contact'].forEach(k => r[k] && (c[k] = r[k]));
    if (r.kind === 'visit') c.visits++; if (r.kind === 'order') c.orders += +r.value || 0;
    if (r.kind === 'payment') c.collected += +r.amount || 0; if (r.kind === 'quote') c.quotes += +r.value || 0;
    m.set(r.customerKey, c);
  });
  return [...m.values()].sort((a, b) => b.last - a.last);
}
const userName = uid => (S.users.get(uid) || {}).name || '';

/* ---------- shell ---------- */
function navFor() {
  if (DB.isMgr()) return {
    side: [['Overview', [['dashboard', 'dash', 'Dashboard'], ['activity', 'activity', 'Live activity'], ['map', 'map', 'Map & live']]],
           ['Sales', [['pipeline', 'kanban', 'Pipeline'], ['calendar', 'cal', 'Follow-ups'], ['customers', 'store', 'Customers'], ['records', 'table', 'All records']]],
           ['Team', [['team', 'users', 'Team & targets'], ['attendance', 'fp', 'Attendance'], ...(DB.isAdmin() ? [['payroll', 'wallet', 'Payroll']] : [])]],
           ['My work', [['today', 'home', 'My day'], ['report', 'send', 'Daily report'], ...(DB.isAdmin() ? [] : [['myatt', 'calcheck', 'My attendance']])]]],
    bottom: [['dashboard', 'dash', 'Home'], ['activity', 'activity', 'Live'], ['attendance', 'fp', 'Attendance'], ['team', 'users', 'Team'], ['more', 'more', 'More']]};
  return {side: [['Sales', [['today', 'home', 'Today'], ['quotes', 'quote', 'Quotations'], ['followups', 'clock', 'Follow-ups'], ['customers', 'store', 'Customers']]],
                 ['Entries', [['list/visit', 'pin', 'Visits'], ['list/order', 'box', 'Orders'], ['list/payment', 'rupee', 'Collections'], ['report', 'send', 'Daily report']]],
                 ['Me', [['myatt', 'calcheck', 'Attendance & leave'], ['payslips', 'wallet', 'My payslips']]]],
    bottom: [['today', 'home', 'Today'], ['quotes', 'quote', 'Quotes'], ['followups', 'clock', 'Follow-ups'], ['myatt', 'calcheck', 'Attendance'], ['more', 'more', 'More']]};
}
function shell() {
  const n = navFor(), p = S.profile;
  root.innerHTML = `<div class="app">
    <aside class="side">${brand(LE.ROLES[p.role])}
      <nav>${n.side.map(([g, items]) => `<div class="grp">${g}</div>` + items.map(([r, ic, l]) => `<a href="#/${r}" data-r="${r}">${icon(ic)}<span>${l}</span>${r === 'followups' || r === 'calendar' ? '<span class="badge" data-due hidden></span>' : ''}</a>`).join('')).join('')}</nav>
      <div class="me"><span class="avatar">${LE.initials(p.name)}</span><div><b>${esc(p.name)}</b><small>${esc(p.email)}</small></div><button class="icon-btn" data-act="logout" title="Sign out">${icon('logout')}</button></div>
    </aside>
    <div class="mainc"><header class="topbar">${brand()}<div class="top-title" id="ttl"></div>${p.role === 'sales' ? '<span class="sync" id="loc" data-act="locinfo" style="cursor:pointer"><i></i><span></span></span>' : ''}<span class="sync" id="sync"><i></i><span></span></span><span class="avatar" data-act="account" title="My account">${LE.initials(p.name)}</span></header>
      <main class="view" id="view"></main></div></div>
    <nav class="bnav">${n.bottom.map(([r, ic, l]) => `<a href="#/${r}" data-r="${r}">${icon(ic)}<span>${l}</span>${r === 'followups' ? '<span class="badge" data-due hidden></span>' : ''}</a>`).join('')}</nav>
    <button class="fab" data-act="new" aria-label="New entry">${icon('plus')}</button>`;
  st.shellFor = S.user.uid + p.role;
}
function syncPill() {
  const el = $('#sync'); if (!el) return;
  const p = DB.pending().length, s = S.state;
  const [c, t] = !navigator.onLine ? ['wait', p ? `Offline · ${p} queued` : 'Offline'] : s === 'denied' ? ['bad', 'No permission'] : s === 'error' ? ['bad', 'Sync error'] :
    p ? ['wait', `Syncing ${p}`] : s === 'live' ? ['live', 'Live · synced'] : ['wait', 'Connecting…'];
  el.className = 'sync ' + c; el.lastElementChild.textContent = t;
  const due = dueQuotes(!DB.isMgr()).filter(q => q.followUp <= today()).length;
  $$('[data-due]').forEach(b => { b.hidden = !due; b.textContent = due; });
}

function locPill() {
  const el = $('#loc'); if (!el) return;
  const t = S.track, [c, txt] = t.state === 'on' ? ['live', 'Location on'] : t.state === 'starting' ? ['wait', 'Locating…'] : t.state === 'off' ? ['', 'Location off'] : ['bad', 'Location off'];
  el.className = 'sync ' + c; el.lastElementChild.textContent = txt; el.title = t.err || 'Your location is shared with the owner while this app is open';
  const h = $('#trk'); if (h) h.innerHTML = trackLine();
}
function trackLine() {
  const t = S.track;
  if (t.state === 'on') return `<span style="color:var(--green)">●</span> Location sharing on · ${t.lastWrite ? 'last sent ' + LE.ago(t.lastWrite) : 'sending…'} · ${t.count} update(s) this session`;
  if (t.state === 'starting') return '<span style="color:var(--amber)">●</span> Starting location sharing…';
  return `<span style="color:var(--red)">●</span> Location sharing is off${t.err ? ' (' + esc(t.err) + ')' : ''} — <a href="#" data-act="locretry">turn on</a>`;
}

/* ---------- router ---------- */
function route() { const h = location.hash.replace(/^#\/?/, '') || (DB.isMgr() ? 'dashboard' : 'today'); return h; }
let rq = 0;
function render(force) {
  cancelAnimationFrame(rq);
  rq = requestAnimationFrame(() => draw(force));
}
function screenKey() {
  if (!S.user) return 'auth:' + st.authMode;
  if (!S.profile) return S.profileErr ? 'offline' : S.user.email === BOOT_EMAIL ? 'verify' : 'noaccess';
  if (!S.profile.active) return 'blocked'; if (S.profile.mustChangePassword) return 'cp'; return 'app';
}
function draw() {
  const k = screenKey();
  if (k !== 'app' && st.screen === k + (S.user ? S.user.uid : '') && $('.auth')) return;   // don't wipe a half-filled form
  st.screen = k + (S.user ? S.user.uid : '');
  if (!S.user) return authScreen();
  if (!S.profile) return S.profileErr ? simple('You are offline', 'Connect to the internet once to finish signing in on this device.', true) :
    (S.user.email === BOOT_EMAIL ? verifyScreen() : simple('No access yet', `This login (${esc(S.user.email || 'anonymous')}) is not set up as an employee. Ask the owner to add you from the Team screen.`, true));
  if (!S.profile.active) return simple('Account deactivated', 'Your access has been turned off by the owner. Contact Lalit Enterprises if this is a mistake.', true);
  if (S.profile.mustChangePassword) return changePwScreen(true);
  if (st.shellFor !== S.user.uid + S.profile.role || !$('#view')) shell();
  const r = route(), [name, ...args] = r.split('/');
  const v = V[name] || V[DB.isMgr() ? 'dashboard' : 'today'];
  if (v.mgr && !DB.isMgr()) { location.hash = '#/today'; return; }
  if (v.admin && !DB.isAdmin()) { location.hash = DB.isMgr() ? '#/dashboard' : '#/today'; return; }
  const view = $('#view'), focus = document.activeElement && document.activeElement.dataset.keep, sel = focus && [document.activeElement.selectionStart, document.activeElement.selectionEnd];
  if (st.route !== r) { st.route = r; scrollTo(0, 0); }
  $('#ttl').textContent = typeof v.title === 'function' ? v.title(...args) : v.title;
  view.innerHTML = v.render(...args);
  $$('[data-r]').forEach(a => a.classList.toggle('on', a.dataset.r === r || (name === 'customer' && a.dataset.r === 'customers') || (name === 'list' && a.dataset.r === 'more' && !$('.side').offsetParent)));
  v.after && v.after(view, ...args);
  if (focus) { const el = $(`[data-keep="${focus}"]`); if (el) { el.focus(); try { el.setSelectionRange(...sel); } catch {} } }
  syncPill(); locPill();
}
addEventListener('hashchange', () => render());

/* ---------- auth screens ---------- */
function authWrap(inner) { root.innerHTML = `<div class="auth"><div class="auth-card">${brand('Sales force · Lalit Enterprises')}<div class="card">${inner}</div><p class="note" style="text-align:center;margin-top:14px">Lalit Enterprises · Ranchi · since 1991</p></div></div>`; }
const msgs = () => (st.authErr ? `<div class="err">${esc(st.authErr)}</div>` : '') + (st.authMsg ? `<div class="ok">${esc(st.authMsg)}</div>` : '');
const OWNER_SETUP_HASH = '#/owner-setup';   // hidden recovery route (see SETUP.md); not linked from the login screen
addEventListener('hashchange', () => { if (!S.user) { st.authMode = location.hash === OWNER_SETUP_HASH ? 'setup' : 'login'; st.authErr = st.authMsg = ''; authScreen(); } });
function authScreen() {
  st.shellFor = '';
  if (location.hash === OWNER_SETUP_HASH) st.authMode = 'setup';
  if (st.authMode === 'setup') {
    authWrap(`<h1>First-time owner setup</h1><p class="sub">For the owner only. Creates the admin login for <b>${BOOT_EMAIL}</b>. Employees are added later by the owner.</p>
      <form id="af"><label class="f">Owner email<input value="${BOOT_EMAIL}" readonly></label>
      <label class="f">Choose a password (min 8)<input name="pw" type="password" minlength="8" required autocomplete="new-password"></label>
      <label class="f">Confirm password<input name="pw2" type="password" minlength="8" required autocomplete="new-password"></label>
      ${msgs()}<button class="btn pri lg full" style="margin-top:16px">Create owner account</button></form>
      <div class="links"><a data-am="login">← Back to sign in</a></div>`);
    $('#af').onsubmit = async e => {
      e.preventDefault(); const f = e.target; st.authErr = st.authMsg = '';
      if (f.pw.value !== f.pw2.value) { st.authErr = 'Passwords do not match.'; return authScreen(); }
      busy(f, true);
      try { await DB.ownerSignup(f.pw.value); }
      catch (er) { st.authErr = er.code === 'auth/email-already-in-use' ? 'The owner account already exists. Sign in with its password, or use "Forgot password" to set a new one.' : LE.errMsg(er); st.authMode = er.code === 'auth/email-already-in-use' ? 'login' : 'setup'; if (st.authMode === 'login') history.replaceState(null, '', location.pathname + location.search); authScreen(); }
    };
  } else {
    authWrap(`<h1>Sign in</h1><p class="sub">Use the email and password given by the owner.</p>
      <form id="af"><label class="f">Email<input name="email" type="email" required autocomplete="username" inputmode="email" value="${esc(st.lastEmail || '')}"></label>
      <label class="f">Password<input name="pw" type="password" required autocomplete="current-password"></label>
      ${msgs()}<button class="btn pri lg full" style="margin-top:16px">Sign in</button></form>
      <div class="links"><a data-am="forgot">Forgot password?</a></div>`);
    $('#af').onsubmit = async e => {
      e.preventDefault(); const f = e.target; st.authErr = st.authMsg = ''; st.lastEmail = f.email.value; busy(f, true);
      try { await DB.login(f.email.value, f.pw.value); } catch (er) { st.authErr = LE.errMsg(er); authScreen(); }
    };
  }
  $$('[data-am]').forEach(a => a.onclick = async () => {
    if (a.dataset.am === 'forgot') {
      const em = ($('input[name=email]') || {}).value || '';
      if (!em) { st.authErr = 'Type your email above, then tap "Forgot password?".'; st.authMsg = ''; return authScreen(); }
      try { await DB.resetPw(em); st.authErr = ''; st.authMsg = `If ${em} has an account, a password reset link has been sent. Check inbox and spam.`; } catch (er) { st.authErr = LE.errMsg(er); }
      st.lastEmail = em; return authScreen();
    }
    if (a.dataset.am === 'login' && location.hash === OWNER_SETUP_HASH) { history.replaceState(null, '', location.pathname + location.search); }
    st.authMode = a.dataset.am; st.authErr = st.authMsg = ''; authScreen();
  });
}
function busy(f, on) { $$('button', f).forEach(b => { b.disabled = on; if (on) b.dataset.t = b.textContent, b.textContent = 'Please wait…'; else if (b.dataset.t) b.textContent = b.dataset.t; }); }
function verifyScreen() {
  authWrap(`<h1>Verify owner email</h1><p class="sub">We sent a verification link to <b>${BOOT_EMAIL}</b>. Open it (check spam), then come back and tap Continue. This makes you the admin.</p>
    <form id="vf"><label class="f">Your name<input name="name" value="Ankit Kumar Mahto" required></label>
    <label class="f">Phone<input name="phone" value="+91 70042 21338" inputmode="tel"></label>
    ${msgs()}<button class="btn pri lg full" style="margin-top:16px">I've verified — continue</button></form>
    <div class="links"><a id="resend">Resend link</a><a id="so">Sign out</a></div>`);
  $('#vf').onsubmit = async e => { e.preventDefault(); const f = e.target; st.authErr = ''; busy(f, true);
    try { await DB.claimAdmin(f.name.value.trim(), f.phone.value.trim()); st.authMsg = ''; render(); } catch (er) { st.authErr = LE.errMsg(er); verifyScreen(); } };
  $('#resend').onclick = async () => { try { await DB.resendVerify(); st.authMsg = 'Verification link sent again.'; st.authErr = ''; } catch (er) { st.authErr = LE.errMsg(er); } verifyScreen(); };
  $('#so').onclick = () => DB.logout();
}
function simple(t, m, out) { authWrap(`<h1>${t}</h1><p class="sub" style="margin-top:8px">${m}</p>${out ? '<button class="btn full" style="margin-top:18px" id="so">Sign out</button>' : ''}`); if (out) $('#so').onclick = () => DB.logout(); }
function changePwScreen(forced) {
  const html = `<h1>${forced ? 'Set your own password' : 'Change password'}</h1><p class="sub">${forced ? 'You signed in with a temporary password. Choose a new one to continue.' : 'Choose a new password (min 8 characters).'}</p>
    <form id="cp"><label class="f">New password<input name="pw" type="password" minlength="8" required autocomplete="new-password"></label>
    <label class="f">Confirm<input name="pw2" type="password" minlength="8" required autocomplete="new-password"></label>
    <div id="cpm"></div><div class="${forced ? '' : 'modal-f'}" style="margin-top:16px">${forced ? '' : '<button type="button" class="btn ghost" data-close>Cancel</button>'}<button class="btn pri ${forced ? 'lg full' : ''}">Save password</button></div></form>`;
  if (forced) authWrap(html); else modal(html);
  $('#cp').onsubmit = async e => { e.preventDefault(); const f = e.target;
    if (f.pw.value !== f.pw2.value) { $('#cpm').innerHTML = '<div class="err">Passwords do not match.</div>'; return; }
    busy(f, true);
    try { await DB.changePassword(f.pw.value); if (!forced) closeModal(); LE.toast('Password updated'); render(); }
    catch (er) { busy(f, false); $('#cpm').innerHTML = `<div class="err">${esc(LE.errMsg(er))}</div>`; } };
}

/* ---------- modal ---------- */
function modal(html, cls = '') {
  closeModal();
  const m = document.createElement('div'); m.className = 'modal'; m.id = 'modal';
  m.innerHTML = `<div class="modal-in ${cls}">${html}</div>`; document.body.appendChild(m); document.body.style.overflow = 'hidden';
  m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-close]')) closeModal(); });
  return m;
}
function closeModal() { const m = $('#modal'); if (m) { m.remove(); document.body.style.overflow = ''; if (S.profile) render(); } }
const mh = t => `<div class="modal-h"><h2>${t}</h2><button type="button" class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>`;

/* ---------- entry forms ---------- */
const chips = (name, opts, val) => `<div class="chips" data-chips="${name}" style="margin-top:7px">${opts.map(o => `<button type="button" class="chip ${String(val).toLowerCase() === o.toLowerCase() ? 'on' : ''}" data-v="${o}">${o}</button>`).join('')}</div><input type="hidden" name="${name}" value="${esc(val)}">`;
const custField = (v = '') => `<label class="f">Customer / firm name *<input name="customer" required list="custList" value="${esc(v)}" autocomplete="off" placeholder="Shop or company name"></label>
  <datalist id="custList">${customers().slice(0, 400).map(c => `<option value="${esc(c.name)}">`).join('')}</datalist>`;
function newMenu() {
  modal(`${mh('New entry')}<div class="sheet-menu">
    <button data-new="visit"><span class="qa-i" style="color:var(--cyan);background:rgba(94,231,255,.1)">${icon('pin')}</span>Check-in visit</button>
    <button data-new="quote"><span style="color:var(--amber);background:rgba(255,197,61,.12)">${icon('quote')}</span>Quotation</button>
    <button data-new="order"><span style="color:var(--green);background:rgba(61,220,151,.12)">${icon('box')}</span>Order taken</button>
    <button data-new="payment"><span style="color:var(--violet);background:rgba(182,156,255,.13)">${icon('rupee')}</span>Collection</button></div>`);
}
function form(kind, pre = {}) {
  let body = '';
  const edit = !!pre.id;
  if (kind === 'visit') body = `${custField(pre.customer)}
    <label class="f">Customer type</label>${chips('ctype', LE.TYPES, pre.ctype || 'Retailer')}
    <div class="row2"><label class="f">Contact person<input name="contact" value="${esc(pre.contact || '')}"></label><label class="f">Phone<input name="phone" inputmode="tel" value="${esc(pre.phone || '')}"></label></div>
    <label class="f">Requirement<textarea name="requirement" placeholder="What does the customer need?">${esc(pre.requirement || '')}</textarea></label>
    <label class="f">Products discussed<input name="products" value="${esc(pre.products || '')}" placeholder="e.g. Siemens MCB, Kühl fans, wires"></label>
    ${edit ? '' : `<div class="gps" id="gps">${icon('pin')}<span>Getting your location…</span></div>`}`;
  if (kind === 'quote') body = `${custField(pre.customer)}
    <div class="row2"><label class="f">Quote value (₹) *<input name="value" required inputmode="decimal" type="number" min="0" step="any" value="${esc(pre.value ?? '')}"></label><label class="f">Phone<input name="phone" inputmode="tel" value="${esc(pre.phone || '')}"></label></div>
    <label class="f">Status</label>${chips('status', ['Hot', 'Warm', 'Cold', 'Won', 'Lost'], pre.status || 'warm')}
    <div class="row2"><label class="f">Follow-up date<input name="followUp" type="date" value="${pre.followUp || LE.addDays(today(), 2)}"></label><label class="f">Expected order<input name="expected" type="date" value="${pre.expected || ''}"></label></div>
    <label class="f">Note / items<input name="note" value="${esc(pre.note || '')}" placeholder="Brand, items, quote no."></label>`;
  if (kind === 'order') body = `${custField(pre.customer)}
    <label class="f">Order value (₹) *<input name="value" required inputmode="decimal" type="number" min="0" step="any" value="${esc(pre.value ?? '')}"></label>
    <label class="f">Items / note<textarea name="items" placeholder="e.g. 20 MCB 32A Siemens, 5 coils 2.5mm">${esc(pre.items || '')}</textarea></label>`;
  if (kind === 'payment') body = `${custField(pre.customer)}
    <label class="f">Amount received (₹) *<input name="amount" required inputmode="decimal" type="number" min="0" step="any" value="${esc(pre.amount ?? '')}"></label>
    <label class="f">Mode</label>${chips('mode', LE.MODES, pre.mode || 'Cash')}
    <label class="f">Reference (UPI / cheque no. / UTR)<input name="ref" value="${esc(pre.ref || '')}"></label>`;
  const canDel = edit && (pre.ownerUid === S.user.uid || DB.isAdmin());
  modal(`<form id="f" data-kind="${kind}" data-id="${pre.id || ''}">${mh((edit ? 'Edit ' : kind === 'visit' ? 'Check-in ' : 'New ') + LE.KINDS[kind].toLowerCase())}${edit && pre.ownerName ? `<p class="note">By ${esc(pre.ownerName)} · ${nice(pre.date)} ${time(pre.ts)}</p>` : ''}${body}
    <div class="modal-f">${canDel ? `<button type="button" class="btn danger" id="del" style="flex:0 0 auto">Delete</button>` : '<button type="button" class="btn ghost" data-close>Cancel</button>'}<button class="btn pri" type="submit">${edit ? 'Save changes' : 'Save'}</button></div></form>`);
  const f = $('#f');
  f.addEventListener('click', e => { const c = e.target.closest('.chip'); if (!c) return; const g = c.parentElement; $$('.chip', g).forEach(x => x.classList.remove('on')); c.classList.add('on'); f.elements[g.dataset.chips].value = c.dataset.v; });
  f.customer.addEventListener('change', () => {
    const c = customers().find(x => x.key === LE.key(f.customer.value)); if (!c) return;
    ['contact', 'phone'].forEach(k => { if (f[k] && !f[k].value && c[k]) f[k].value = c[k]; });
    if (f.ctype && c.ctype) { f.ctype.value = c.ctype; $$('[data-chips=ctype] .chip', f).forEach(x => x.classList.toggle('on', x.dataset.v === c.ctype)); }
  });
  if (kind === 'visit' && !edit) gps(f);
  $('#del') && ($('#del').onclick = () => { if (confirm('Delete this entry? It will be hidden from all reports.')) { DB.save({...pre, deleted: true, open: false}); closeModal(); LE.toast('Deleted'); } });
  f.addEventListener('submit', e => { e.preventDefault(); submit(f, pre); });
}
function gps(f) {
  const box = $('#gps'); if (!box) return;
  if (!navigator.geolocation) { box.innerHTML = `${icon('pin')}<span>GPS not available on this device</span>`; return; }
  box.className = 'gps'; box.innerHTML = `${icon('pin')}<span>Getting your location…</span>`;
  navigator.geolocation.getCurrentPosition(p => {
    const c = p.coords; f._gps = {lat: c.latitude, lng: c.longitude, accuracy: Math.round(c.accuracy), gpsTs: p.timestamp};
    box.className = 'gps ok'; box.innerHTML = `${icon('check')}<span>Checked in at your location (±${Math.round(c.accuracy)} m) · <a href="${map(c.latitude, c.longitude)}" target="_blank" rel="noopener">map</a> · <a href="#" data-regps>refresh</a></span>`;
  }, e => { box.className = 'gps'; box.innerHTML = `${icon('pin')}<span>Location not captured (${esc(e.message || 'denied')}). Turn on GPS and allow location. <a href="#" data-regps>Try again</a></span>`; },
  {enableHighAccuracy: true, timeout: 20000, maximumAge: 30000});
  box.onclick = e => { if (e.target.closest('[data-regps]')) { e.preventDefault(); gps(f); } };
}
function submit(f, pre) {
  const kind = f.dataset.kind, fd = Object.fromEntries(new FormData(f));
  Object.keys(fd).forEach(k => typeof fd[k] === 'string' && (fd[k] = fd[k].trim()));
  if (kind === 'visit' && !pre.id) { if (f._gps) Object.assign(fd, f._gps); else if (!confirm('Location not captured. Save visit without GPS?')) return; }
  if (fd.value !== undefined) fd.value = +fd.value || 0; if (fd.amount !== undefined) fd.amount = +fd.amount || 0;
  if (fd.status) fd.status = fd.status.toLowerCase();
  const r = DB.save({...pre, kind, ...fd});
  if (kind === 'visit' && !pre.id && f._gps) DB.Track.checkin(f._gps);
  closeModal(); LE.toast(`${LE.KINDS[kind]} saved`);
  if (kind === 'quote' && r.status === 'won' && pre.status !== 'won' && confirm('Quotation won 🎉 Add it as an order now?')) form('order', {customer: r.customer, value: r.value, items: r.note});
}
function setStatus(id, status) {
  const q = S.records.get(id) || S.openQ.get(id); if (!q) return;
  if (q.ownerUid !== S.user.uid && !DB.isAdmin()) return LE.toast('Only the owner of this quote or the admin can change it');
  DB.save({...q, status}); LE.toast(`Moved to ${status}`);
}

/* ---------- daily report ---------- */
function reportText(d = today()) {
  const own = mine().filter(r => r.date === d), K = k => own.filter(r => r.kind === k);
  const vis = K('visit').sort((a, b) => a.ts - b.ts), q = K('quote'), o = K('order'), p = K('payment');
  const tm = LE.addDays(d, 1), dq = dueQuotes(true), fu = dq.filter(x => x.followUp === tm), od = dq.filter(x => x.followUp < d);
  const L = ['*Lalit Enterprises – Daily Sales Report*', `Salesperson: ${S.profile.name}${S.profile.territory ? ' (' + S.profile.territory + ')' : ''}`, `Date: ${niceLong(d)}`, '', `*Visits: ${vis.length}*`];
  vis.forEach((v, i) => L.push(`${i + 1}. ${v.customer}${v.ctype ? ' (' + v.ctype + ')' : ''} ${time(v.ts)}${v.requirement ? ' – ' + v.requirement : ''}${v.lat != null ? '\n   📍 ' + map(v.lat.toFixed(5), v.lng.toFixed(5)) : ' – no GPS'}`));
  L.push('', `*Quotations: ${q.length} · ${money(LE.sum(q, 'value'))}*`); q.forEach(x => L.push(`• ${x.customer} ${money(x.value)} (${x.status})${x.followUp ? ' – follow-up ' + nice(x.followUp) : ''}`));
  L.push('', `*Orders: ${o.length} · ${money(LE.sum(o, 'value'))}*`); o.forEach(x => L.push(`• ${x.customer} ${money(x.value)}${x.items ? ' – ' + x.items : ''}`));
  L.push('', `*Collections: ${money(LE.sum(p, 'amount'))}*`);
  const modes = LE.MODES.map(m => [m, LE.sum(p.filter(x => x.mode === m), 'amount')]).filter(x => x[1]);
  if (modes.length) L.push(modes.map(([m, v]) => `${m} ${money(v)}`).join(' | '));
  p.forEach(x => L.push(`• ${x.customer} ${money(x.amount)} ${x.mode}${x.ref ? ' (' + x.ref + ')' : ''}`));
  L.push('', `*Follow-ups tomorrow (${nice(tm)}): ${fu.length}*`); fu.forEach(x => L.push(`• ${x.customer} ${money(x.value)} (${x.status})`));
  if (od.length) L.push('', `⚠️ Overdue follow-ups: ${od.length}`, ...od.map(x => `• ${x.customer} ${money(x.value)} – due ${nice(x.followUp)}`));
  return L.join('\n');
}
const waLink = t => `https://wa.me/${OWNER_WA}?text=${encodeURIComponent(t)}`;

/* ---------- shared list items ---------- */
const KIC = {visit: 'pin', quote: 'quote', order: 'box', payment: 'rupee'};
function li(r, o = {}) {
  let t = esc(r.customer || '—'), a = '', m = [];
  if (r.kind === 'visit') { m.push(...[r.ctype, r.requirement].filter(Boolean).map(esc)); m.push(r.lat != null ? `<a href="${map(r.lat, r.lng)}" target="_blank" rel="noopener">📍 map ±${Math.round(r.accuracy || 0)}m</a>` : '<span style="color:var(--red)">no GPS</span>'); }
  if (r.kind === 'quote') { a = money(r.value); m.push(`<span class="tag ${r.status}">${r.status}</span>`); r.followUp && m.push('follow-up ' + nice(r.followUp)); }
  if (r.kind === 'order') { a = money(r.value); r.items && m.push(esc(r.items)); }
  if (r.kind === 'payment') { a = money(r.amount); m.push(esc([r.mode, r.ref].filter(Boolean).join(' · '))); }
  const who = o.who && r.ownerName ? `<span>${esc(r.ownerName)}</span>` : '';
  return `<div class="li tap ${st.fresh.has(r.id) ? 'new' : ''}" data-open="${r.id}"><span class="dot ${r.kind}">${icon(KIC[r.kind])}</span><div class="b">
    <div class="t"><span>${t}</span>${a ? `<span class="amt">${a}</span>` : ''}</div>
    <div class="m"><span>${LE.KINDS[r.kind]}</span><span>·</span><span>${o.date ? nice(r.date) + ' ' : ''}${time(r.ts)}</span>${who ? '<span>·</span>' + who : ''}${m.length ? '<span>·</span>' + m.join(' ') : ''}</div></div></div>`;
}
function fuItem(q, o = {}) {
  const od = q.followUp < today(), td = q.followUp === today(), ph = (q.phone || '').replace(/\D/g, '');
  return `<div class="li"><span class="dot quote">${icon('clock')}</span><div class="b">
    <div class="t"><span>${esc(q.customer)}</span><span class="amt">${money(q.value)}</span></div>
    <div class="m"><span class="tag ${od ? 'overdue' : td ? 'today' : q.status}">${od ? 'Overdue' : td ? 'Today' : nice(q.followUp)}</span><span class="tag ${q.status}">${q.status}</span>${od ? `<span>due ${nice(q.followUp)}</span>` : ''}${o.who ? `<span>· ${esc(q.ownerName || '')}</span>` : ''}${q.note ? `<span>· ${esc(q.note)}</span>` : ''}</div>
    <div class="a"><button class="btn sm" data-open="${q.id}">${icon('edit')}Update</button>${ph ? `<a class="btn sm" href="tel:${ph}">${icon('phone')}Call</a><a class="btn sm" target="_blank" rel="noopener" href="https://wa.me/${ph.length === 10 ? '91' + ph : ph}">${icon('wa')}WhatsApp</a>` : ''}</div></div></div>`;
}
const listCard = (items, empty) => `<div class="card pad0"><div class="list">${items.length ? items.join('') : `<div style="padding:14px"><div class="empty">${empty}</div></div>`}</div></div>`;
const kpi = (cls, ic, v, l, s = '') => `<div class="kpi ${cls}"><div class="ico">${icon(ic)}</div><div class="v">${v}</div><div class="l">${l}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
const pctBar = (a, t, cls = '') => { const p = t ? Math.min(100, Math.round(a / t * 100)) : 0; return `<div class="bar ${cls}"><i style="width:${p}%"></i></div>`; };

/* ---------- salesperson views ---------- */
V.today = {title: () => DB.isMgr() ? 'My day' : 'Today', render() {
  const d = today(), own = mine(), td = own.filter(r => r.date === d), K = k => td.filter(r => r.kind === k);
  const due = dueQuotes(true).filter(q => q.followUp <= d);
  const m = LE.month(), mo = own.filter(r => r.date.startsWith(m)), t = S.targets.get(`${S.user.uid}_${m}`);
  const ms = LE.sum(mo.filter(r => r.kind === 'order'), 'value'), mc = LE.sum(mo.filter(r => r.kind === 'payment'), 'amount'), mv = mo.filter(r => r.kind === 'visit').length;
  const hr = new Date().getHours(), greet = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  return `<div class="grid">${typeof ATT !== 'undefined' && !DB.isAdmin() ? ATT.todayCard() : ''}
   <div class="hero"><h1>${greet}, ${esc(S.profile.name.split(' ')[0])}</h1><p>${niceLong(d)}${S.profile.territory ? ' · ' + esc(S.profile.territory) : ''}</p>${S.profile.role === 'sales' ? `<p class="note" id="trk" style="margin-top:6px">${trackLine()}</p>` : ''}
    ${t ? `<div class="tgt"><div><b>${short(ms)}</b>Sales of ${short(t.sales)}${pctBar(ms, t.sales)}</div><div><b>${short(mc)}</b>Collected of ${short(t.collection)}${pctBar(mc, t.collection, 'g')}</div><div><b>${mv}</b>Visits of ${t.visits}${pctBar(mv, t.visits, 'c')}</div></div>` : `<p class="note">No target set for ${LE.monthName(m)} yet.</p>`}</div>
   <div class="qa"><button class="visit" data-new="visit"><span>${icon('pin')}</span>Check-in</button><button class="quote" data-new="quote"><span>${icon('quote')}</span>Quote</button><button class="order" data-new="order"><span>${icon('box')}</span>Order</button><button class="payment" data-new="payment"><span>${icon('rupee')}</span>Collect</button></div>
   <div class="kpis k4">${kpi('cyan', 'pin', K('visit').length, 'Visits today')}${kpi('amber', 'quote', short(LE.sum(K('quote'), 'value')), `${K('quote').length} quotation(s)`)}${kpi('green', 'box', short(LE.sum(K('order'), 'value')), `${K('order').length} order(s)`)}${kpi('violet', 'rupee', short(LE.sum(K('payment'), 'amount')), `${K('payment').length} collection(s)`)}</div>
   <button class="btn wa lg full" data-act="report">${icon('send')}Send daily report on WhatsApp</button>
   ${due.length ? `<div><div class="card-h" style="margin:6px 2px 8px"><h3>Follow-ups due</h3><a href="#/followups" class="sub">See all</a></div>${listCard(due.slice(0, 4).map(q => fuItem(q)), '')}</div>` : ''}
   <div><div class="card-h" style="margin:6px 2px 8px"><h3>Today's timeline</h3><span class="sub">${td.length} entries</span></div>${listCard(td.sort((a, b) => b.ts - a.ts).map(r => li(r)), 'No entries yet today. Tap Check-in when you reach a customer.')}</div>
  </div>`;
}};
V.quotes = {title: 'Quotations', render() {
  const f = st.q.qs || 'open', qs = mine().filter(r => r.kind === 'quote');
  const cnt = s => s === 'open' ? qs.filter(LE.isOpen).length : qs.filter(q => q.status === s).length;
  const list = qs.filter(q => f === 'open' ? LE.isOpen(q) : q.status === f).sort((a, b) => (a.followUp || '9').localeCompare(b.followUp || '9'));
  const val = LE.sum(list, 'value');
  return `<div class="page-h"><div><h1>Quotations</h1><p>${list.length} · ${money(val)}</p></div><button class="btn pri" data-new="quote">${icon('plus')}New quote</button></div>
   <div class="chips scroll" style="margin-bottom:12px">${['open', ...LE.STATUS].map(s => `<button class="chip ${f === s ? 'on' : ''}" data-qs="${s}">${s === 'open' ? 'Open pipeline' : s[0].toUpperCase() + s.slice(1)} <span class="n">${cnt(s)}</span></button>`).join('')}</div>
   ${listCard(list.map(q => li(q, {date: true})), 'No quotations here.')}`;
}};
V.followups = {title: 'Follow-ups', render() {
  const d = today(), a = dueQuotes(!DB.isMgr()), od = a.filter(q => q.followUp < d), td = a.filter(q => q.followUp === d), up = a.filter(q => q.followUp > d).slice(0, 50);
  const sec = (t, x, e) => `<div><div class="card-h" style="margin:14px 2px 8px"><h3>${t}</h3><span class="sub">${x.length} · ${money(LE.sum(x, 'value'))}</span></div>${listCard(x.map(q => fuItem(q, {who: DB.isMgr()})), e)}</div>`;
  return `<div class="page-h"><div><h1>Follow-ups</h1><p>Open quotations (hot / warm / cold) by follow-up date</p></div></div>${sec('Overdue', od, 'Nothing overdue 👍')}${sec('Today', td, 'No follow-ups today')}${sec('Upcoming', up, 'No upcoming follow-ups')}`;
}};
V.customers = {title: 'Customers', render() {
  const q = (st.q.cust || '').toLowerCase(), cs = customers().filter(c => !q || c.name.toLowerCase().includes(q) || (c.phone || '').includes(q));
  return `<div class="page-h"><div><h1>Customers</h1><p>${cs.length} accounts from the last ${DB.isMgr() ? MGR_DAYS : WINDOW_DAYS} days</p></div></div>
   <div class="card pad0"><div class="tbl-tools"><div class="search">${icon('search')}<input data-keep="cust" data-q="cust" placeholder="Search name or phone" value="${esc(st.q.cust || '')}"></div></div>
   <div class="list">${cs.slice(0, 300).map(c => `<div class="li tap" data-cust="${esc(c.key)}"><span class="avatar">${LE.initials(c.name)}</span><div class="b"><div class="t"><span>${esc(c.name)}</span><span class="amt">${short(c.orders)}</span></div>
    <div class="m">${c.ctype ? `<span>${esc(c.ctype)}</span><span>·</span>` : ''}<span>${c.visits} visit(s)</span><span>·</span><span>collected ${short(c.collected)}</span><span>·</span><span>last ${LE.ago(c.last)}</span>${DB.isMgr() ? `<span>· ${esc([...c.reps].filter(Boolean).join(', '))}</span>` : ''}</div></div></div>`).join('') || '<div style="padding:14px"><div class="empty">No customers yet</div></div>'}</div></div>`;
}};
V.customer = {title: 'Customer', render(key) {
  key = decodeURIComponent(key || '');
  const c = customers().find(x => x.key === key) || {name: key, key};
  const h = st.hist && st.hist.key === key ? st.hist.recs : null;
  const recs = h || scope().filter(r => r.customerKey === key).sort((a, b) => b.ts - a.ts);
  const K = k => recs.filter(r => r.kind === k), ph = (c.phone || '').replace(/\D/g, '');
  return `<div class="page-h"><div><a href="#/customers" class="note">← Customers</a><h1 style="margin-top:4px">${esc(c.name)}</h1><p>${[c.ctype, c.contact, c.phone].filter(Boolean).map(esc).join(' · ') || 'No contact details yet'}</p></div>
    <div class="toolbar">${ph ? `<a class="btn" href="tel:${ph}">${icon('phone')}Call</a><a class="btn" target="_blank" rel="noopener" href="https://wa.me/${ph.length === 10 ? '91' + ph : ph}">${icon('wa')}WhatsApp</a>` : ''}<button class="btn pri" data-newfor="visit">${icon('pin')}Check-in</button><button class="btn" data-newfor="quote">${icon('quote')}Quote</button></div></div>
   <div class="kpis k4" style="margin-bottom:14px">${kpi('cyan', 'pin', K('visit').length, 'Visits')}${kpi('amber', 'quote', short(LE.sum(K('quote'), 'value')), 'Quoted')}${kpi('green', 'box', short(LE.sum(K('order'), 'value')), 'Orders')}${kpi('violet', 'rupee', short(LE.sum(K('payment'), 'amount')), 'Collected')}</div>
   <div class="card-h" style="margin:4px 2px 8px"><h3>History</h3><span class="sub">${h ? 'Full history' : 'Loading full history…'}</span></div>
   ${listCard(recs.map(r => li(r, {date: true, who: DB.isMgr()})), 'No entries')}`;
}, after(el, key) {
  key = decodeURIComponent(key || '');
  if (!st.hist || st.hist.key !== key) { st.hist = {key, recs: null}; DB.customerHistory(key).then(recs => { st.hist = {key, recs}; render(); }).catch(e => { console.warn(e); st.hist = {key, recs: scope().filter(r => r.customerKey === key).sort((a, b) => b.ts - a.ts)}; render(); }); }
}};
V.list = {title: k => ({visit: 'Visits', order: 'Orders', payment: 'Collections', quote: 'Quotations'})[k] || 'Entries', render(k) {
  const a = mine().filter(r => r.kind === k).sort((x, y) => y.ts - x.ts), tot = k === 'payment' ? LE.sum(a, 'amount') : LE.sum(a, 'value');
  return `<div class="page-h"><div><h1>${V.list.title(k)}</h1><p>${a.length} in the last ${WINDOW_DAYS} days${k !== 'visit' ? ' · ' + money(tot) : ''}</p></div><button class="btn pri" data-new="${k}">${icon('plus')}New</button></div>${listCard(a.slice(0, 300).map(r => li(r, {date: true})), 'Nothing yet')}`;
}};
V.report = {title: 'Daily report', render() {
  const t = reportText();
  return `<div class="page-h"><div><h1>Daily report</h1><p>Check it, then send. WhatsApp opens with this message ready for the owner (+91 70042 21338).</p></div></div>
   <div class="card" style="max-width:640px"><pre class="report" style="margin:0">${esc(t)}</pre><div class="toolbar" style="margin-top:12px"><button class="btn" data-act="copyrep">Copy</button><a class="btn wa" id="waSend" target="_blank" rel="noopener" href="${waLink(t)}">${icon('send')}Send on WhatsApp</a></div></div>`;
}};
V.more = {title: 'More', render() {
  const p = S.profile, items = DB.isMgr()
    ? [['pipeline', 'kanban', 'Pipeline'], ['map', 'map', 'Map & live tracking'], ['attendance', 'fp', 'Attendance & leave'], ...(DB.isAdmin() ? [['payroll', 'wallet', 'Payroll & payslips']] : [['myatt', 'calcheck', 'My attendance'], ['payslips', 'wallet', 'My payslips']]), ['calendar', 'cal', 'Follow-up calendar'], ['customers', 'store', 'Customers'], ['records', 'table', 'All records & CSV'], ['today', 'home', 'My day'], ['report', 'send', 'My daily report']]
    : [['customers', 'store', 'Customers'], ['myatt', 'calcheck', 'My attendance & leave'], ['payslips', 'wallet', 'My payslips'], ['list/visit', 'pin', 'My visits'], ['list/order', 'box', 'My orders'], ['list/payment', 'rupee', 'My collections'], ['report', 'send', 'Daily report']];
  return `<div class="card" style="display:flex;gap:12px;align-items:center"><span class="avatar" style="width:46px;height:46px">${LE.initials(p.name)}</span><div><b>${esc(p.name)}</b><div class="note" style="margin:2px 0 0">${esc(p.email)} · <span class="tag ${p.role}">${p.role}</span></div></div></div>
   <div class="card pad0" style="margin-top:12px"><div class="list">${items.map(([r, ic, l]) => `<a class="li tap" href="#/${r}" style="color:var(--tx)"><span class="dot">${icon(ic)}</span><div class="b" style="align-self:center"><div class="t"><span>${l}</span></div></div></a>`).join('')}
    <div class="li tap" data-act="csvmine"><span class="dot">${icon('download')}</span><div class="b" style="align-self:center"><div class="t"><span>Export my entries (CSV)</span></div></div></div>
    <div class="li tap" data-act="account"><span class="dot">${icon('key')}</span><div class="b" style="align-self:center"><div class="t"><span>Change password</span></div></div></div>
    <div class="li tap" data-act="logout"><span class="dot" style="color:var(--red)">${icon('logout')}</span><div class="b" style="align-self:center"><div class="t"><span>Sign out</span></div></div></div></div></div>
   <p class="note" style="text-align:center;margin-top:16px">LE Sales v3 · ${DB.pending().length} entr${DB.pending().length === 1 ? 'y' : 'ies'} waiting to sync${S.indexFallback ? ' · index fallback' : ''}</p>`;
}};

/* ---------- global events ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act],[data-new],[data-newfor],[data-open],[data-cust],[data-qs]'); if (!t) return;
  if (t.dataset.new) { closeModal(); form(t.dataset.new); }
  else if (t.dataset.newfor) { const c = customers().find(x => x.key === decodeURIComponent(route().split('/')[1] || '')) || {}; form(t.dataset.newfor, {customer: c.name, phone: c.phone, contact: c.contact, ctype: c.ctype}); }
  else if (t.dataset.open) { if (e.target.closest('a[href]')) return; const r = S.records.get(t.dataset.open) || S.openQ.get(t.dataset.open); if (r) { if (r.ownerUid !== S.user.uid && !DB.isAdmin()) return LE.toast('View only — entry by ' + (r.ownerName || 'another user')); form(r.kind, r); } }
  else if (t.dataset.cust) location.hash = '#/customer/' + encodeURIComponent(t.dataset.cust);
  else if (t.dataset.qs) { st.q.qs = t.dataset.qs; render(); }
  else ({
    locinfo: () => modal(`${mh('Location sharing')}<p class="sub" style="color:var(--mut)">While you are signed in and this app is open, your location is sent to Lalit Enterprises every ~2 minutes and when you move, so the owner can see where the team is and plan visits. It stops when you sign out or close the app.</p><div class="ok" id="trkm">${trackLine()}</div><div class="modal-f"><button class="btn" data-close>Close</button><button class="btn pri" data-act="locretry">Restart location</button></div>`),
    locretry: () => { DB.Track.retry(); LE.toast('Asking for location…'); },
    new: newMenu, logout: () => { if (confirm('Sign out?')) DB.logout(); },
    account: () => changePwScreen(false),
    report: () => { const tx = reportText(); modal(`${mh('Daily report')}<p class="note">Check it, then tap Send. WhatsApp opens with this ready for the owner.</p><pre class="report" id="repText">${esc(tx)}</pre><div class="modal-f"><button class="btn" data-act="copyrep">Copy</button><a class="btn wa" id="waSend" href="${waLink(tx)}" target="_blank" rel="noopener">${icon('send')}Send on WhatsApp</a></div>`); },
    copyrep: () => navigator.clipboard?.writeText(reportText()).then(() => LE.toast('Copied')),
    csvmine: () => LE.download(`le-sales-${S.profile.name.replace(/\s+/g, '-')}-${today()}.csv`, LE.toCSV(mine().sort((a, b) => a.ts - b.ts)), 'text/csv;charset=utf-8'),
  })[t.dataset.act]?.();
});
document.addEventListener('input', e => { const k = e.target.dataset.q; if (k) { st.q[k] = e.target.value; render(); } });
document.addEventListener('change', e => { const k = e.target.dataset.sel; if (k) { st.q[k] = e.target.value; render(); } });

/* ---------- boot ---------- */
DB.on(what => {
  if (what === 'data' && S.loaded) {
    const ids = [...S.records.keys()];
    if (!st.seen) st.seen = new Set(ids);
    else ids.forEach(id => { if (!st.seen.has(id)) { st.seen.add(id); const r = S.records.get(id); if (r.ownerUid !== S.user.uid) { st.fresh.add(id); setTimeout(() => st.fresh.delete(id), 4000); } } });
  }
  if (what === 'auth') { st.seen = null; st.hist = null; if (!S.user) { closeModal(); st.shellFor = ''; st.authErr = st.authMsg = ''; st.authMode = 'login'; } }
  if (what === 'state') return syncPill();
  if (what === 'track') { locPill(); const m = $('#trkm'); if (m) m.innerHTML = trackLine(); return; }
  if (what === 'loc') { const r = route(); if (!$('#modal') && (r.startsWith('map') || r === 'dashboard')) render(); return; }
  if (!document.querySelector('.modal') && S.user && S.profile && S.profile.active && S.profile.role === 'sales' && !localStorage.getItem('le2_locnotice_' + S.user.uid) && !S.profile.mustChangePassword) {
    localStorage.setItem('le2_locnotice_' + S.user.uid, '1');
    setTimeout(() => modal(`${mh('Location sharing is on')}<p class="sub" style="color:var(--mut)">Lalit Enterprises uses your location while this app is open: every ~2 minutes, when you move, and at each customer check-in. The owner and managers can see it on the live map. Please allow location when your phone asks.</p><div class="modal-f"><button class="btn pri" data-close>OK, understood</button></div>`), 600);
  }
  if ($('#modal') && what === 'data') return syncPill();   // don't redraw under an open form
  render();
});
root.innerHTML = `<div class="auth"><div class="auth-card">${brand()}<p class="note" style="text-align:center">Loading…</p></div></div>`;
return {V, st, render, all, mine, scope, openQuotes, dueQuotes, customers, li, fuItem, listCard, kpi, pctBar, modal, closeModal, mh, form, setStatus, reportText, waLink, userName, $, $$};
})();
