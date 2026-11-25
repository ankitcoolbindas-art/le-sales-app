/* LE Sales v2 — shared helpers, constants, icons */
const BOOT_EMAIL = 'ankitcoolbindas@gmail.com';
const OWNER_WA = '917004221338';
const WINDOW_DAYS = 120;   // salesperson: own history kept on the phone
const MGR_DAYS = 60;       // admin/manager dashboards: live window (reads per open ≈ records in this window)
const LE = {
  esc: s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
  money: n => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN'),
  short: n => { n = Number(n) || 0; const a = Math.abs(n); return '₹' + (a >= 1e7 ? (n / 1e7).toFixed(2) + ' Cr' : a >= 1e5 ? (n / 1e5).toFixed(a >= 1e6 ? 1 : 2) + ' L' : a >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : Math.round(n)); },
  num: n => (Number(n) || 0).toLocaleString('en-IN'),
  dstr: d => { const x = new Date(d); return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10); },
  today: () => LE.dstr(Date.now()),
  month: (d = LE.today()) => d.slice(0, 7),
  addDays: (ds, n) => { const d = new Date(ds + 'T12:00:00'); d.setDate(d.getDate() + n); return LE.dstr(d); },
  nice: ds => ds ? new Date(ds + 'T12:00:00').toLocaleDateString('en-IN', {day: 'numeric', month: 'short'}) : '',
  niceLong: ds => new Date(ds + 'T12:00:00').toLocaleDateString('en-IN', {weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'}),
  monthName: m => new Date(m + '-15T12:00:00').toLocaleDateString('en-IN', {month: 'long', year: 'numeric'}),
  time: ts => new Date(ts).toLocaleTimeString('en-IN', {hour: 'numeric', minute: '2-digit'}),
  ago: ts => { const s = (Date.now() - ts) / 1000; return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + 'm ago' : s < 86400 ? Math.floor(s / 3600) + 'h ago' : Math.floor(s / 86400) + 'd ago'; },
  uid: () => Date.now().toString(36).padStart(9, '0') + Math.random().toString(36).slice(2, 8),
  key: s => String(s || '').toLowerCase().replace(/[^a-z0-9\u0900-\u097f]+/g, ' ').trim(),
  map: (lat, lng) => `https://maps.google.com/?q=${lat},${lng}`,
  initials: n => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0].toUpperCase()).join(''),
  KINDS: {visit: 'Visit', quote: 'Quotation', order: 'Order', payment: 'Collection'},
  TYPES: ['Retailer', 'Contractor', 'Builder', 'Industry', 'Govt', 'Other'],
  MODES: ['Cash', 'UPI', 'Cheque', 'NEFT'],
  STATUS: ['hot', 'warm', 'cold', 'won', 'lost'],
  ROLES: {admin: 'Admin (owner)', manager: 'Manager', sales: 'Salesperson'},
  isOpen: r => r.kind === 'quote' && !r.deleted && ['hot', 'warm', 'cold'].includes(r.status),
  sum: (a, f) => a.reduce((s, r) => s + (Number(r[f]) || 0), 0),
  CSV_COLS: ['id','kind','ownerName','date','time','customer','ctype','contact','phone','requirement','products','lat','lng','accuracy','mapUrl','value','expected','status','followUp','amount','mode','ref','items','note','deleted'],
  toCSV(recs) {
    const q = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const rows = recs.map(r => LE.CSV_COLS.map(c => q(c === 'time' ? new Date(r.ts).toLocaleTimeString('en-IN') : c === 'mapUrl' ? (r.lat != null ? LE.map(r.lat, r.lng) : '') : r[c])).join(','));
    return '\ufeff' + LE.CSV_COLS.join(',') + '\n' + rows.join('\n');
  },
  download(name, text, type) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], {type})); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  },
  toast(msg, ms = 2600) { const t = document.getElementById('toast'); if (!t) return; t.textContent = msg; t.classList.add('show'); clearTimeout(LE._t); LE._t = setTimeout(() => t.classList.remove('show'), ms); },
  load(src, css) { return new Promise((ok, no) => { if (css) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = css; document.head.appendChild(l); } const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('Could not load ' + src)); document.head.appendChild(s); }); },
  errMsg(e) {
    const c = e && e.code || '';
    return ({'auth/invalid-credential': 'Wrong email or password.', 'auth/wrong-password': 'Wrong email or password.', 'auth/user-not-found': 'No account with this email.',
      'auth/invalid-email': 'Please enter a valid email.', 'auth/email-already-in-use': 'This email already has an account.', 'auth/weak-password': 'Password must be at least 8 characters.',
      'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.', 'auth/network-request-failed': 'No internet connection.',
      'auth/requires-recent-login': 'Please sign out and sign in again, then retry.', 'permission-denied': 'You do not have permission for this.',
      'failed-precondition': 'Database index is still being built — try again in a few minutes.'})[c] || (e && e.message) || String(e);
  }
};
/* Lucide-style stroke icons */
const IC = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  dash: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  kanban: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 7v7M12 7v4M16 7v9"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  map: '<path d="M9 3 3 6v15l6-3 6 3 6-3V3l-6 3z"/><path d="M9 3v15M15 6v15"/>',
  table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
  store: '<path d="M3 9 4.5 4h15L21 9M3 9v11h18V9M3 9h18M9 20v-6h6v6"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  quote: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  rupee: '<path d="M6 3h12M6 8h12M6 13l8.5 8M6 13h3a5 5 0 0 0 0-10"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  wa: '<path d="M3 21l1.65-4.5A8.5 8.5 0 1 1 7.5 19.4z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 1c-1 0-2.5-1.5-2.5-2.5l1-1-1-2z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  wifi: '<path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 9a15 15 0 0 1 20 0"/><circle cx="12" cy="19.5" r="1"/>',
};
const icon = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n] || ''}</svg>`;
