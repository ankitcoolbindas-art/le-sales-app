// v3 attendance & payroll end-to-end on the emulators, MOCK data only. Screenshots -> le-sales-app/screens/v3-*.png
import puppeteer from 'puppeteer-core';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc, setDoc, updateDoc} from 'firebase/firestore';
import fs from 'fs';
const B = 'http://localhost:8765/?emu=1', OUT = '/workspace/le-sales-app/screens/', P = 'le-sales-app';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const res = {}, errs = [];
const step = (k, v) => { res[k] = v; console.log('•', k, typeof v === 'object' ? JSON.stringify(v) : v); };
const nav = async (p, r) => { await p.evaluate(r => { location.hash = '#/' + r; }, r); await p.waitForFunction(r => location.hash === '#/' + r && document.querySelector('#view') && document.querySelector('#view').children.length, {timeout: 15000}, r); await sleep(600); };
await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${P}/databases/(default)/documents`, {method: 'DELETE'});
await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${P}/accounts`, {method: 'DELETE'});
const b = await puppeteer.launch({executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=/workspace/le-sales-tools/mock/cam.y4m']});
const mk = async (name, vp, geo) => { const c = await b.createBrowserContext(); await c.overridePermissions('http://localhost:8765', ['geolocation', 'camera']); const p = await c.newPage();
  p.on('pageerror', e => errs.push(name + ' PAGEERROR ' + e.message)); p.on('console', m => { const t = m.text(); if (m.type() === 'error' && !/ERR_|404|tile|nominatim|favicon/i.test(t)) errs.push(name + ' ' + t); });
  p.on('dialog', d => d.accept(d.type() === 'prompt' ? 'Not enough staff that day' : undefined)); await p.setViewport(vp); if (geo) await p.setGeolocation(geo); return p; };
const D = {width: 1440, height: 900, deviceScaleFactor: 1}, M = {width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true};
const shot = async (p, o) => { await p.evaluate(() => { const t = document.getElementById('toast'); t && t.classList.remove('show'); }); await sleep(300); await p.screenshot(o); };
const dismiss = async p => { await p.waitForSelector('.modal [data-close]', {timeout: 3000}).then(async () => { await sleep(200); await p.click('.modal .btn.pri[data-close], .modal [data-close]'); }).catch(() => {}); await sleep(300); };

// ---------- owner bootstrap ----------
const a = await mk('ADMIN', D);
await a.goto(B + '#/owner-setup', {waitUntil: 'networkidle0'}); await a.waitForSelector('input[name=pw2]');
await a.type('input[name=pw]', 'OwnerTest-123'); await a.type('input[name=pw2]', 'OwnerTest-123'); await a.click('#af button');
await a.waitForSelector('#vf', {timeout: 15000});
const oob = await (await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${P}/oobCodes`)).json(); await fetch(oob.oobCodes.find(o => o.requestType === 'VERIFY_EMAIL').oobLink);
await a.click('#vf button'); await a.waitForSelector('.side', {timeout: 15000}); step('adminSignedIn', true);
await nav(a, 'team'); await a.click('[data-seg=tt][data-v=emp]'); await sleep(300);
const addEmp = async (name, email, phone, terr, role) => { await a.click('#addEmp'); await a.waitForSelector('#ef'); await a.type('#ef [name=name]', name); await a.type('#ef [name=email]', email); await a.type('#ef [name=phone]', phone); await a.type('#ef [name=territory]', terr); await a.select('#ef [name=role]', role);
  const pw = await a.$eval('#ef [name=password]', e => e.value); await a.click('#ef .btn.pri'); await a.waitForFunction(() => document.querySelector('.modal .ok'), {timeout: 15000}); await a.click('.modal [data-close]'); await sleep(300); return pw; };
const E = [['Rahul Kumar', 'rahul.test@example.com', '9876500001', 'Main Road', 'sales'], ['Amit Singh', 'amit.test@example.com', '9876500002', 'Kishoreganj', 'sales'], ['Vikash Oraon', 'vikash.test@example.com', '9876500004', 'Harmu', 'sales'], ['Priya Sharma', 'priya.test@example.com', '9876500003', 'All Ranchi', 'manager']];
const pw = {}; for (const e of E) pw[e[1]] = await addEmp(...e);
const users = await a.evaluate(() => [...DB.S.users.values()].map(u => ({uid: u.uid, name: u.name, email: u.email, role: u.role})));
const U = Object.fromEntries(users.map(u => [u.email.split('.')[0], u])); step('employees', users.map(u => u.name));

// ---------- seed MOCK history (rules disabled) ----------
const env = await initializeTestEnvironment({projectId: P, firestore: {host: '127.0.0.1', port: 8080}});
const ist = ms => new Date(ms + 330 * 60000).toISOString().slice(0, 10), TODAY = ist(Date.now());
const at = (ds, h, m) => new Date(`${ds}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+05:30`).getTime();
const PH = [0, 1, 2, 3].map(i => 'data:image/jpeg;base64,' + fs.readFileSync(`/workspace/le-sales-tools/mock/p${i}.png`).toString('base64'));
const ADDR = ['Main Road, Ranchi', 'Kishoreganj, Ranchi', 'Lalpur, Ranchi', 'Harmu, Ranchi', 'Doranda, Ranchi', 'Kanke Road, Ranchi'];
let seed = 7; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
const HOL = '2026-11-12';
await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  await setDoc(doc(db, 'settings/attendance'), {start: '10:00', grace: 15, halfHours: 4, weekOff: [0], holidays: [{date: HOL, name: 'Sample holiday (mock)'}], basis: 'calendar', latePerHalf: 3, updatedAt: Date.now(), updatedBy: 'seed'});
  const sal = {rahul: [18000, 'Sales Executive'], amit: [15000, 'Sales Executive'], vikash: [14000, 'Field Sales'], priya: [25000, 'Sales Manager']};
  for (const [k, u] of Object.entries(U)) {
    if (!sal[k]) continue;
    await updateDoc(doc(db, 'users/' + u.uid), {createdAt: Date.parse('2026-10-01T10:00:00+05:30')});
    await setDoc(doc(db, 'salary/' + u.uid), {uid: u.uid, monthly: sal[k][0], joinDate: '2026-10-01', designation: sal[k][1], updatedAt: Date.now(), updatedBy: 'seed'});
    for (let t = Date.parse('2026-10-01T12:00:00+05:30'); ist(t) < TODAY; t += 86400000) {
      const ds = ist(t), dw = new Date(ds + 'T12:00:00').getDay(); if (dw === 0 || ds === HOL) continue;
      if (k === 'amit' && (ds === '2026-11-18' || ds === '2026-11-19')) continue;   // approved leave
      const x = rnd(); if (x < 0.05) continue;                                        // absent
      const late = rnd() < 0.15, inM = late ? 20 + Math.floor(rnd() * 35) : -20 + Math.floor(rnd() * 30);
      const inTs = at(ds, 10, 0) + inM * 60000, half = x > 0.95, noOut = x > 0.92 && x <= 0.95;
      const outTs = half ? at(ds, 13, 10 + Math.floor(rnd() * 40)) : at(ds, 18, Math.floor(rnd() * 59)) + Math.floor(rnd() * 60) * 60000;
      const ad = ADDR[Math.floor(rnd() * ADDR.length)], la = 23.344 + (rnd() - .5) * .06, ln = 85.31 + (rnd() - .5) * .06;
      const d = {uid: u.uid, name: u.name, date: ds, month: ds.slice(0, 7), status: noOut ? 'in' : 'out', inAt: new Date(inTs), inTs, inLat: +la.toFixed(6), inLng: +ln.toFixed(6), inAcc: 8 + Math.floor(rnd() * 30), inAddr: ad, inFlags: rnd() < .04 ? ['poorGps'] : [], inSrc: 'web', createdAt: inTs, updatedAt: inTs};
      if (!noOut) Object.assign(d, {outAt: new Date(outTs), outTs, outLat: +(la + .01).toFixed(6), outLng: +(ln - .01).toFixed(6), outAcc: 10 + Math.floor(rnd() * 20), outAddr: ADDR[Math.floor(rnd() * ADDR.length)], outFlags: [], outSrc: 'web', hours: Math.round((outTs - inTs) / 36000) / 100});
      await setDoc(doc(db, `attendance/${u.uid}_${ds}`), d);
      if (ds >= '2026-11-20') { await setDoc(doc(db, `attendancePhotos/${u.uid}_${ds}_in`), {uid: u.uid, date: ds, kind: 'in', img: PH[Math.floor(rnd() * 4)], ts: inTs}); if (!noOut) await setDoc(doc(db, `attendancePhotos/${u.uid}_${ds}_out`), {uid: u.uid, date: ds, kind: 'out', img: PH[Math.floor(rnd() * 4)], ts: outTs}); }
    }
  }
  await setDoc(doc(db, 'leaves/seed1'), {uid: U.amit.uid, name: U.amit.name, from: '2026-11-18', to: '2026-11-19', days: 2, type: 'CL', reason: 'Sister’s wedding', status: 'approved', paid: true, decidedBy: 'seed', decidedByName: 'Ankit Kumar Mahto', decidedAt: Date.now(), createdAt: Date.parse('2026-11-10'), updatedAt: Date.now()});
  await setDoc(doc(db, 'leaves/seed2'), {uid: U.vikash.uid, name: U.vikash.name, from: '2026-11-30', to: '2026-11-30', days: 1, type: 'SL', reason: 'Doctor appointment', status: 'pending', createdAt: Date.now() - 3600000, updatedAt: Date.now()});
});
step('seeded', 'Oct–Nov mock attendance, salaries, leaves, settings');
await a.reload({waitUntil: 'load'}); await a.waitForSelector('.side', {timeout: 15000});

// ---------- employee: check in with live selfie ----------
const login = async (p, email, pass, newPw) => { await p.goto(B, {waitUntil: 'networkidle0'}); await p.waitForSelector('#af'); await p.type('[name=email]', email); await p.type('[name=pw]', pass); await p.click('#af button');
  if (newPw) { await p.waitForSelector('#cp', {timeout: 15000}); await p.type('#cp [name=pw]', newPw); await p.type('#cp [name=pw2]', newPw); await p.click('#cp .btn.pri'); }
  await p.waitForSelector('#view', {timeout: 15000}); await sleep(800); await dismiss(p); };
const s = await mk('RAHUL', M, {latitude: 23.3615, longitude: 85.3240, accuracy: 14});
await login(s, 'rahul.test@example.com', pw['rahul.test@example.com'], 'RahulNew-456');
await s.waitForSelector('[data-att=in]', {timeout: 15000}).catch(async e => { await shot(s, {path: '/tmp/dbg.png'}); console.log('DBG', await s.evaluate(() => (document.querySelector('#view')||document.body).innerText.slice(0,600)), errs); throw e; }); await sleep(400);
await shot(s, {path: OUT + 'v3-sales-today-mobile.png'}); step('todayCard', await s.$eval('.attc', e => e.innerText.replace(/\s+/g, ' ')));
await s.click('[data-att=in]'); await s.waitForSelector('#snap:not([disabled])', {timeout: 15000}); await s.waitForSelector('#agps.ok', {timeout: 20000}); await sleep(1500);
await shot(s, {path: OUT + 'v3-sales-checkin-camera-mobile.png'}); step('cameraLive', await s.$eval('#camv', v => v.videoWidth + 'x' + v.videoHeight));
await s.click('#snap'); await s.waitForSelector('#confirm', {timeout: 5000}); await sleep(400);
await shot(s, {path: OUT + 'v3-sales-checkin-mobile.png'});
const photoKB = await s.$eval('#camimg', i => Math.round(i.src.length * 3 / 4 / 1024)); step('photoKB', photoKB);
await s.click('#confirm'); await s.waitForSelector('.attc.on', {timeout: 20000}); await sleep(500);
step('checkedIn', await s.$eval('.attc', e => e.innerText.replace(/\s+/g, ' ')));
await shot(s, {path: OUT + 'v3-sales-checkedin-mobile.png'});
// second check-in must be refused by rules even if forced
step('doubleCheckInBlocked', await s.evaluate(async () => { try { const d = LE.today(), id = DB.S.user.uid + '_' + d, db = firebase.firestore(); await db.collection('attendance').doc(id).set({uid: DB.S.user.uid, name: 'x', date: d, month: d.slice(0, 7), status: 'in', inAt: firebase.firestore.FieldValue.serverTimestamp(), inTs: Date.now(), inFlags: [], createdAt: 1, updatedAt: 1}); return 'NOT BLOCKED'; } catch (e) { return e.code; } }));
await nav(s, 'myatt'); await sleep(800); await shot(s, {path: OUT + 'v3-sales-attendance-top-mobile.png'}); await s.evaluate(() => { const c = document.querySelector('.att-cal'); window.scrollTo(0, c.getBoundingClientRect().top + scrollY - 70); }); await sleep(300); await shot(s, {path: OUT + 'v3-sales-attendance-mobile.png'});
step('myCalendar', await s.$eval('.att-legend', e => e.innerText.replace(/\s+/g, ' ')));
// leave request
await s.click('[data-att=leave]'); await s.waitForSelector('#lf'); await s.$eval('#lf [name=from]', e => { e.value = '2026-12-03'; e.dispatchEvent(new Event('change')); }); await s.$eval('#lf [name=to]', e => { e.value = '2026-12-04'; e.dispatchEvent(new Event('change')); });
await s.type('#lf [name=reason]', 'Village visit'); await shot(s, {path: OUT + 'v3-sales-leave-request-mobile.png'}); await s.click('#lf .btn.pri'); await sleep(1500);
step('leaveSent', await s.$$eval('.li', l => l.map(x => x.innerText.replace(/\s+/g, ' ')).filter(t => /pending/i.test(t)).length));
// day detail with own photo
await s.evaluate(() => { const c = document.querySelector('.att-cal [data-attday$="2026-11-24"]') || document.querySelector('.att-cal [data-attday]'); c && c.click(); }); await sleep(1500);
await shot(s, {path: OUT + 'v3-sales-day-detail-mobile.png'}); await dismiss(s);

// Amit: check in and out (out flow)
const am = await mk('AMIT', M, {latitude: 23.3702, longitude: 85.3301, accuracy: 260});
await login(am, 'amit.test@example.com', pw['amit.test@example.com'], 'AmitNew-456');
await am.waitForSelector('[data-att=in]'); await am.click('[data-att=in]'); await am.waitForSelector('#snap:not([disabled])', {timeout: 15000}); await am.waitForSelector('#agps.bad,#agps.ok', {timeout: 20000}); await sleep(800);
await am.click('#snap'); await am.waitForSelector('#confirm'); await am.click('#confirm'); await am.waitForSelector('[data-att=out]', {timeout: 20000}); await sleep(600);
await am.click('[data-att=out]'); await am.waitForSelector('#snap:not([disabled])', {timeout: 15000}); await am.waitForSelector('#agps.bad,#agps.ok', {timeout: 20000}); await sleep(800);
await am.click('#snap'); await am.waitForSelector('#confirm'); await shot(am, {path: OUT + 'v3-sales-checkout-mobile.png'}); await am.click('#confirm'); await am.waitForSelector('.attc.done', {timeout: 20000});
step('amitDone', await am.$eval('.attc', e => e.innerText.replace(/\s+/g, ' ')));

// ---------- admin: today board ----------
await nav(a, 'attendance'); await a.waitForFunction(() => document.querySelectorAll('.thumb img').length >= 3, {timeout: 20000}); await sleep(500);
await shot(a, {path: OUT + 'v3-admin-attendance-today-desktop.png'});
step('board', await a.$$eval('.att-row', r => r.map(x => x.innerText.replace(/\s+/g, ' ').slice(0, 90))));
await a.click(`.att-row[data-attday^="${U.rahul.uid}"]`); await a.waitForFunction(() => document.querySelectorAll('.att-side .ph img').length >= 1, {timeout: 15000}); await sleep(300);
await shot(a, {path: OUT + 'v3-admin-attendance-day-desktop.png'}); await dismiss(a);
// register + override
await a.click('[data-seg=at][data-v=reg]'); await a.waitForSelector('.reg table', {timeout: 15000}); await sleep(600);
await shot(a, {path: OUT + 'v3-admin-register-desktop.png'});
const absentCell = await a.$('.reg td.rc.st-a[data-attday]'); step('hasAbsentCell', !!absentCell);
if (absentCell) { await absentCell.click(); await a.waitForSelector('#ovf'); await a.select('#ovf [name=st]', 'P'); await a.type('#ovf [name=why]', 'Field visit to Hazaribagh, confirmed by phone'); await a.click('#ovf .btn.pri'); await sleep(1500);
  step('overrideSaved', await a.$$eval('.reg i.ov', x => x.length)); }
// CSV
const cdp = await a.target().createCDPSession(); await cdp.send('Browser.setDownloadBehavior', {behavior: 'allow', downloadPath: '/tmp/le-dl'}).catch(() => cdp.send('Page.setDownloadBehavior', {behavior: 'allow', downloadPath: '/tmp/le-dl'}));
await a.evaluate(() => { window._dl = []; const o = LE.download; LE.download = (n, t, ty) => { window._dl.push([n, t.split('\n').length, t.split('\n').slice(0, 3).join(' | ').slice(0, 300)]); }; window._odl = o; });
await a.click('#regcsv'); await sleep(500); step('registerCSV', await a.evaluate(() => window._dl));
// leave approve
await a.click('[data-seg=at][data-v=leave]'); await sleep(500); await shot(a, {path: OUT + 'v3-admin-leaves-desktop.png'});
const appr = await a.$('[data-lv=approve]'); if (appr) { await appr.click(); await sleep(1500); }
step('pendingAfterApprove', await a.$$eval('[data-lv=approve]', x => x.length));
await a.click('[data-seg=at][data-v=rules]'); await sleep(500); await shot(a, {path: OUT + 'v3-admin-rules-desktop.png'});
// ---------- payroll ----------
await nav(a, 'payroll'); await a.click('[data-seg=pt][data-v=sal]'); await sleep(500); await shot(a, {path: OUT + 'v3-admin-salary-desktop.png'});
await a.click('[data-seg=pt][data-v=run]'); await sleep(800); await a.select('[data-sel=pm]', '2026-10'); await a.waitForSelector('[data-payedit]', {timeout: 15000}); await sleep(800);
await a.click('#payall'); await sleep(1500);
await shot(a, {path: OUT + 'v3-admin-payroll-desktop.png'});
step('payrollOct', await a.$$eval('tbody tr', r => r.map(x => x.innerText.replace(/\s+/g, ' ').slice(0, 140))));
await a.click(`[data-payedit="${U.rahul.uid}"]`); await a.waitForSelector('#pf'); await a.type('#pf [name=incentive]', '2500'); await a.type('#pf [name=advance]', '1000'); await a.type('#pf [name=notes]', 'Incentive for Oct collections');
await sleep(300); await shot(a, {path: OUT + 'v3-admin-payroll-edit-desktop.png'});
await a.click('#pfin'); await sleep(1500);
await a.click(`[data-payslip="${U.rahul.uid}"]`); await a.waitForSelector('#payslip'); await sleep(400);
await shot(a, {path: OUT + 'v3-admin-payslip-desktop.png'});
step('payslip', await a.$eval('#payslip', e => e.innerText.replace(/\s+/g, ' ').slice(0, 400))); await dismiss(a);
step('finalizedLocked', await a.evaluate(async uid => { try { await firebase.firestore().collection('payroll').doc(uid + '_2026-10').update({net: 1}); return 'NOT LOCKED'; } catch (e) { return e.code; } }, U.rahul.uid));
// Nov (current month) payroll view too
await a.select('[data-sel=pm]', '2026-11'); await sleep(1200); await shot(a, {path: OUT + 'v3-admin-payroll-nov-desktop.png'});

// ---------- employee sees own finalized payslip; manager cannot see payroll ----------
await nav(s, 'payslips'); await s.waitForSelector('[data-slip]', {timeout: 15000}); await shot(s, {path: OUT + 'v3-sales-payslips-mobile.png'});
await s.click('[data-slip]'); await s.waitForSelector('#payslip'); await sleep(300); await shot(s, {path: OUT + 'v3-sales-payslip-mobile.png', fullPage: false});
const mgr = await mk('PRIYA', D, {latitude: 23.35, longitude: 85.33, accuracy: 20});
await login(mgr, 'priya.test@example.com', pw['priya.test@example.com'], 'PriyaNew-456');
await nav(mgr, 'attendance'); await sleep(800); step('managerSeesAttendance', await mgr.$$eval('.att-row', r => r.length));
step('managerNavHasPayroll', await mgr.$$eval('[data-r=payroll]', x => x.length));
await mgr.evaluate(() => { location.hash = '#/payroll'; }); await sleep(800); step('managerPayrollRedirect', await mgr.evaluate(() => location.hash));
step('managerSalaryRead', await mgr.evaluate(async () => { try { await firebase.firestore().collection('salary').get(); return 'READ!'; } catch (e) { return e.code; } }));

// ---------- admin mobile ----------
const am2 = await mk('ADMIN-M', M); await login(am2, 'ankitcoolbindas@gmail.com', 'OwnerTest-123');
await nav(am2, 'attendance'); await am2.waitForFunction(() => document.querySelectorAll('.thumb img').length >= 2, {timeout: 20000}); await sleep(400);
await shot(am2, {path: OUT + 'v3-admin-attendance-today-mobile.png'});
await am2.click('[data-seg=at][data-v=reg]'); await am2.waitForSelector('.reg table', {timeout: 15000}); await sleep(500); await shot(am2, {path: OUT + 'v3-admin-register-mobile.png'});
await nav(am2, 'payroll'); await am2.select('[data-sel=pm]', '2026-10'); await sleep(1200); await shot(am2, {path: OUT + 'v3-admin-payroll-mobile.png'});
await am2.click(`[data-payslip="${U.rahul.uid}"]`); await am2.waitForSelector('#payslip'); await sleep(300); await shot(am2, {path: OUT + 'v3-admin-payslip-mobile.png'});

step('consoleErrors', errs);
fs.writeFileSync('/workspace/le-sales-tools/e2e-v3-result.json', JSON.stringify(res, null, 1));
await env.cleanup(); await b.close(); process.exit(0);
