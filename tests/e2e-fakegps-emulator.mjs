// v3.1 fake-GPS e2e (emulator, mock data only). Run after e2e-v3.mjs (reuses its seeded emulator users).
import puppeteer from 'puppeteer-core'; import fs from 'fs';
const B = 'http://localhost:8765/?emu=1', OUT = '/workspace/le-sales-app/screens/', P = 'le-sales-app';
const sleep = ms => new Promise(r => setTimeout(r, ms)); const res = {}, errs = [];
const step = (k, v) => { res[k] = v; console.log('•', k, typeof v === 'object' ? JSON.stringify(v) : v); };
const b = await puppeteer.launch({executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=/workspace/le-sales-tools/mock/cam.y4m']});
const D = {width: 1440, height: 900, deviceScaleFactor: 1}, M = {width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true};
const mk = async (name, vp, stub) => { const c = await b.createBrowserContext(); await c.overridePermissions('http://localhost:8765', ['geolocation', 'camera']); const p = await c.newPage();
  p.on('pageerror', e => errs.push(name + ' PAGEERROR ' + e.message)); p.on('console', m => { const t = m.text(); if (m.type() === 'error' && !/ERR_|404|tile|nominatim|favicon/i.test(t)) errs.push(name + ' ' + t); });
  p.on('dialog', d => d.accept()); await p.setViewport(vp);
  if (stub) await p.evaluateOnNewDocument(() => {   // fake Capacitor v1.1 Android bridge
    window.__fake = {mock: true, apps: ['Fake GPS Location'], active: ['Fake GPS Location']};
    const fix = () => ({lat: 23.3441, lng: 85.3096, accuracy: 8, time: Date.now(), mock: __fake.mock, mockAppsInstalled: __fake.apps, mockAppsActive: __fake.active, legacyMockSetting: false});
    const impl = {status: async () => ({appVersion: '1.1.0', active: false}), currentFix: async () => fix(), mockStatus: async () => { const f = fix(); return {mockAppsInstalled: f.mockAppsInstalled, mockAppsActive: f.mockAppsActive, legacyMockSetting: false, mock: f.mock}; },
      isIgnoringBatteryOptimizations: async () => ({value: true}), checkPermissions: async () => ({location: 'granted', background: 'granted', notifications: 'granted'})};
    const LEN = new Proxy(impl, {get: (t, k) => t[k] || (async () => ({}))});
    window.Capacitor = {isNativePlatform: () => true, getPlatform: () => 'android', Plugins: {LENative: LEN, CapacitorHttp: {}}, registerPlugin: () => new Proxy({}, {get: () => async () => ({})})};
  });
  return p; };
const shot = async (p, o) => { await p.evaluate(() => { const t = document.getElementById('toast'); t && t.classList.remove('show'); }); await sleep(300); await p.screenshot(o); };
const dismiss = async p => { await p.evaluate(() => [...document.querySelectorAll('button')].filter(b => b.innerText.trim() === 'Later').forEach(b => b.click())); await sleep(400); for (let i = 0; i < 3; i++) { const c = await p.$('.modal [data-close], .sheet [data-close]'); if (!c) break; await c.click().catch(() => {}); await sleep(300); } };
// reset Vikash's password in the auth emulator (test user only)
const acc = await (await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${P}/accounts:query`, {method: 'POST', headers: {Authorization: 'Bearer owner', 'content-type': 'application/json'}, body: '{}'})).json();
const vik = acc.userInfo.find(u => u.email === 'vikash.test@example.com');
await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${P}/accounts:update`, {method: 'POST', headers: {Authorization: 'Bearer owner', 'content-type': 'application/json'}, body: JSON.stringify({localId: vik.localId, password: 'VikashNew-456'})});
// emulator-only reset of Vikash's today so the test is repeatable
const TODAY = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10), FS = `http://127.0.0.1:8080/v1/projects/${P}/databases/(default)/documents`, H = {Authorization: 'Bearer owner'};
for (const c of ['attendance', 'attendancePhotos']) await fetch(`${FS}/${c}/${vik.localId}_${TODAY}`, {method: 'DELETE', headers: H});
for (const c of ['attendancePhotos']) for (const k of ['in', 'out']) await fetch(`${FS}/${c}/${vik.localId}_${TODAY}_${k}`, {method: 'DELETE', headers: H});
const locs = await (await fetch(`${FS}/locations?pageSize=500`, {headers: H})).json(); for (const d of locs.documents || []) if (d.fields.ownerUid && d.fields.ownerUid.stringValue === vik.localId) await fetch(`http://127.0.0.1:8080/v1/${d.name}`, {method: 'DELETE', headers: H});
const login = async (p, email, pass) => { await p.goto(B, {waitUntil: 'load'}); await p.waitForSelector('#af', {timeout: 20000}); await p.type('[name=email]', email); await p.type('[name=pw]', pass); await p.click('#af button');
  const r = await Promise.race([p.waitForSelector('#cp', {timeout: 15000}).then(() => 'cp'), p.waitForSelector('#view', {timeout: 15000}).then(() => 'v')]);
  if (r === 'cp') { await p.type('#cp [name=pw]', pass + 'x'); await p.type('#cp [name=pw2]', pass + 'x'); await p.click('#cp .btn.pri'); await p.waitForSelector('#view', {timeout: 15000}); }
  await sleep(1200); await dismiss(p); };

const v = await mk('VIKASH-APP', M, true);
await login(v, 'vikash.test@example.com', 'VikashNew-456');
step('nativeDetected', await v.evaluate(async () => { await LE_NATIVE.ready; return {platform: LE_NATIVE.platform, ver: LE_NATIVE.appVersion, mockCheck: !!LE_NATIVE.mockCheck, liveCamera: !!LE_NATIVE.liveCamera}; }));
await v.waitForSelector('[data-att=in]', {timeout: 15000}); await sleep(1500); await dismiss(v); await v.click('[data-att=in]');
await v.waitForSelector('#agps.mockbad', {timeout: 20000}).catch(async e => { await v.screenshot({path: '/tmp/dbg.png'}); console.log('DBG', await v.evaluate(() => document.body.innerText.slice(0, 500)), errs); throw e; }); await sleep(1500);
step('blockedMsg', await v.$eval('#agps', e => e.innerText.replace(/\s+/g, ' ')));
step('snapDisabled', await v.$eval('#snap', e => e.disabled));
await shot(v, {path: OUT + 'v3-sales-fakegps-blocked-mobile.png'});
await v.evaluate(() => { const s = document.querySelector('#snap'); s.disabled = false; s.click(); }); await sleep(600);   // even if forced, confirm must refuse
const cf = await v.$('#confirm'); if (cf) { await v.evaluate(() => { const c = document.querySelector('#confirm'); c.disabled = false; c.click(); }); await sleep(2000); }
step('noAttendanceDoc', await v.evaluate(async () => { try { return !(await firebase.firestore().collection('attendance').doc(DB.S.user.uid + '_' + LE.today()).get()).exists; } catch (e) { return 'no doc (' + e.code + ')'; } }));
step('loggedMockPoint', await v.evaluate(async () => (await firebase.firestore().collection('locations').where('ownerUid', '==', DB.S.user.uid).where('mock', '==', true).get()).docs.map(d => d.data().reason + ' / ' + d.data().mockApp)));
// close modal, turn the fake app off (still installed -> must still block), then uninstall -> check-in works with native fix
await v.evaluate(() => { document.querySelectorAll('.modal [data-close]').forEach(x => x.click()); __fake.mock = false; __fake.active = []; }); await sleep(600);
await v.click('[data-att=in]'); await v.waitForSelector('#agps.mockbad', {timeout: 20000}); step('installedOnlyBlocked', await v.$eval('#agps', e => e.innerText.replace(/\s+/g, ' ').slice(0, 140)));
await v.evaluate(() => { document.querySelectorAll('.modal [data-close]').forEach(x => x.click()); __fake.apps = []; }); await sleep(600);
await v.click('[data-att=in]'); await v.waitForSelector('#agps.ok', {timeout: 20000}); await v.waitForSelector('#snap:not([disabled])', {timeout: 15000}); await sleep(1200);
await v.click('#snap'); await v.waitForSelector('#confirm'); await sleep(300); await v.click('#confirm'); await v.waitForSelector('.attc.on', {timeout: 20000});
step('cleanCheckIn', await v.evaluate(async () => { const d = (await firebase.firestore().collection('attendance').doc(DB.S.user.uid + '_' + LE.today()).get()).data(); return {status: d.status, src: d.inSrc, in: d.inLat ? [d.inLat, d.inLng, d.inAcc] : Object.keys(d).filter(k => /^in/.test(k)), flags: d.inFlags}; }));
await dismiss(v); await shot(v, {path: OUT + 'v3-sales-native-checkedin-mobile.png'});

// admin views
const a = await mk('ADMIN', D); await login(a, 'ankitcoolbindas@gmail.com', 'OwnerTest-123');
await a.evaluate(() => { location.hash = '#/attendance'; }); await a.waitForSelector('.mockbar', {timeout: 20000}); await sleep(800);
step('todayAlert', await a.$eval('.mockbar', e => e.innerText.replace(/\s+/g, ' ')));
step('rowTag', await a.$$eval('.att-row .tag.mock', x => x.length));
await shot(a, {path: OUT + 'v3-admin-fakegps-today.png'});
await a.click('[data-seg=at][data-v=reg]'); await a.waitForSelector('.reg td.rc.mock', {timeout: 20000}); await sleep(500);
step('registerMockCells', await a.$$eval('.reg td.rc.mock', x => x.length));
await shot(a, {path: OUT + 'v3-admin-fakegps-register.png'});
await a.click('.reg td.rc.mock'); await sleep(1500); step('dayModalMock', await a.$eval('.modal', e => (e.innerText.match(/Fake GPS detected[^\n]*/) || [''])[0]));
await shot(a, {path: OUT + 'v3-admin-fakegps-day.png'}); await dismiss(a);
await a.evaluate(() => { location.hash = '#/map'; }); await sleep(3000);
step('liveMockTag', await a.$$eval('.tag.mock', x => x.length));
await shot(a, {path: OUT + 'v3-admin-fakegps-live.png'});
step('consoleErrors', errs);
fs.writeFileSync('/workspace/le-sales-tools/e2e-mock-result.json', JSON.stringify(res, null, 1));
await b.close(); process.exit(0);
