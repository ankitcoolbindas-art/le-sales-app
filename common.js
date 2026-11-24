/* Shared helpers for LE Sales (salesperson app + owner panel) */
const LE = {
  esc: s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
  money: n => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN'),
  dstr: d => { const x = new Date(d); return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10); },
  today: () => LE.dstr(Date.now()),
  addDays: (ds, n) => { const d = new Date(ds + 'T12:00:00'); d.setDate(d.getDate() + n); return LE.dstr(d); },
  nice: ds => ds ? new Date(ds + 'T12:00:00').toLocaleDateString('en-IN', {day: 'numeric', month: 'short'}) : '',
  niceLong: ds => new Date(ds + 'T12:00:00').toLocaleDateString('en-IN', {weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'}),
  time: ts => new Date(ts).toLocaleTimeString('en-IN', {hour: 'numeric', minute: '2-digit'}),
  uid: () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
  map: (lat, lng) => `https://maps.google.com/?q=${lat},${lng}`,
  KINDS: {visit: 'Visit', quote: 'Quotation', order: 'Order', payment: 'Payment'},
  TYPES: ['Retailer', 'Contractor', 'Builder', 'Industry', 'Govt', 'Other'],
  MODES: ['Cash', 'UPI', 'Cheque', 'NEFT'],
  STATUS: ['hot', 'warm', 'cold', 'won', 'lost'],
  isOpen: r => r.kind === 'quote' && !r.deleted && ['hot', 'warm', 'cold'].includes(r.status),
  async sha(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('le-sales:' + s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); },
  CSV_COLS: ['id','kind','rep','date','time','customer','ctype','contact','phone','requirement','products','lat','lng','accuracy','gpsTime','mapUrl','value','expected','status','followUp','amount','mode','ref','items','note','deleted'],
  toCSV(recs) {
    const q = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const rows = recs.map(r => LE.CSV_COLS.map(c => q(c === 'time' ? new Date(r.ts).toLocaleTimeString('en-IN') : c === 'mapUrl' ? (r.lat != null ? LE.map(r.lat, r.lng) : '') : c === 'gpsTime' ? (r.gpsTs ? new Date(r.gpsTs).toISOString() : '') : r[c])).join(','));
    return '\ufeff' + LE.CSV_COLS.join(',') + '\n' + rows.join('\n');
  },
  download(name, text, type) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], {type})); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  },
  toast(msg, ms = 2600) { const t = document.getElementById('toast'); if (!t) return; t.textContent = msg; t.classList.add('show'); clearTimeout(LE._t); LE._t = setTimeout(() => t.classList.remove('show'), ms); }
};
