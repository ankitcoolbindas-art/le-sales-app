// Live map diagnosis e2e (emulator, mock users from e2e-v3.mjs). Checks: mobile nav → live map, empty state, per-person reasons, web tracker shows live.
import puppeteer from 'puppeteer-core'; import fs from 'fs';
const B = 'http://localhost:8765/?emu=1', OUT = '/workspace/le-sales-app/screens/', P = 'le-sales-app';
const sleep = ms => new Promise(r => setTimeout(r, ms)); const res = {}, errs = [];
const step = (k, v) => { res[k] = v; console.log('•', k, typeof v === 'object' ? JSON.stringify(v) : v); };
const FS = `http://127.0.0.1:8080/v1/projects/${P}/databases/(default)/documents`, H = {Authorization: 'Bearer owner', 'content-type': 'application/json'};
const acc = (await (await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${P}/accounts:query`, {method: 'POST', headers: H, body: '{}'})).json()).userInfo;
const uid = e => acc.find(u => u.email === e).localId, R = uid('rahul.test@example.com'), AM = uid('amit.test@example.com'), VK = uid('vikash.test@example.com');
const ll = await (await fetch(`${FS}/lastLocation?pageSize=100`, {headers: H})).json(); for (const d of ll.documents || []) await fetch(`http://127.0.0.1:8080/v1/${d.name}`, {method: 'DELETE', headers: H});
const val = v => typeof v === 'boolean' ? {booleanValue: v} : Number.isInteger(v) ? {integerValue: String(v)} : typeof v === 'number' ? {doubleValue: v} : {stringValue: String(v)};
const put = (id, d) => fetch(`${FS}/lastLocation/${id}`, {method: 'PATCH', headers: H, body: JSON.stringify({fields: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, val(v)]))})});
const ist = ms => new Date(ms + 330 * 60000).toISOString().slice(0, 10);
const b = await puppeteer.launch({executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu']});
const D = {width: 1440, height: 900, deviceScaleFactor: 1}, M = {width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true};
const mk = async (name, vp, geo) => { const c = await b.createBrowserContext(); await c.overridePermissions('http://localhost:8765', ['geolocation']); const p = await c.newPage();
  p.on('pageerror', e => errs.push(name + ' PAGEERROR ' + e.message)); p.on('console', m => { const t = m.text(); if (m.type() === 'error' && !/ERR_|404|tile|nominatim|favicon/i.test(t)) errs.push(name + ' ' + t); });
  await p.setViewport(vp); if (geo) await p.setGeolocation(geo); return p; };
const login = async (p, email, pass) => { await p.goto(B, {waitUntil: 'load'}); await p.waitForSelector('#af', {timeout: 20000}); await p.type('[name=email]', email); await p.type('[name=pw]', pass); await p.click('#af button'); await p.waitForSelector('#view', {timeout: 15000}); await sleep(1500);
  for (let i = 0; i < 3; i++) { const c = await p.$('.modal [data-close]'); if (!c) break; await c.click().catch(() => {}); await sleep(300); } };
const txt = (p, sel) => p.$eval(sel, e => e.innerText.replace(/\s+/g, ' ')).catch(() => null);
const shot = async (p, o) => { await p.evaluate(() => { const t = document.getElementById('toast'); t && t.classList.remove('show'); }); await sleep(400); await p.screenshot(o); };

const am = await mk('ADMIN-M', M); await login(am, 'ankitcoolbindas@gmail.com', 'OwnerTest-123');
step('mobileBottomNav', await am.$$eval('.bottom [data-r], nav [data-r]', x => [...new Set(x.filter(a => a.offsetParent).map(a => a.dataset.r + ':' + a.innerText.trim()))]));
await am.evaluate(() => [...document.querySelectorAll('[data-r=map]')].find(a => a.offsetParent).click()); await am.waitForSelector('#mapslot', {timeout: 10000}); await sleep(1500);
step('hashAfterLiveTap', await am.evaluate(() => location.hash));
step('emptyBanner', await txt(am, '.locbar'));
step('whyEmpty', await am.$$eval('.list .li', x => x.map(e => e.innerText.replace(/\s+/g, ' '))));
await shot(am, {path: OUT + 'v3-admin-livemap-empty-mobile.png'});
// earlier-today browser user (Amit, checked out), yesterday app user (Vikash)
await put(AM, {ownerUid: AM, ownerName: 'Amit Singh', lat: 23.3702, lng: 85.3301, accuracy: 40, ts: Date.now() - 40 * 60000, date: ist(Date.now()), source: 'web', reason: 'interval', appVersion: 'web-2', updatedAt: Date.now()});
await put(VK, {ownerUid: VK, ownerName: 'Vikash Oraon', lat: 23.35, lng: 85.31, accuracy: 9, ts: Date.now() - 26 * 3600000, date: ist(Date.now() - 26 * 3600000), source: 'android', reason: 'interval', appVersion: 'android-1.0.0', updatedAt: Date.now()});
// Rahul (checked in) opens the web app: tracker must show him live
const r = await mk('RAHUL', M, {latitude: 23.3615, longitude: 85.3240, accuracy: 14}); await login(r, 'rahul.test@example.com', 'RahulNew-456');
step('rahulPill', await txt(r, '.locpill, #locpill, .pill'));
await am.waitForFunction(() => /1 of 3 salespeople live/.test(document.querySelector('.page-h p').innerText), {timeout: 30000}).catch(() => {});
await sleep(1500);
step('header', await txt(am, '.page-h p'));
step('banner', await txt(am, '.locbar'));
step('rows', await am.$$eval('.list .li', x => x.map(e => e.innerText.replace(/\s+/g, ' '))));
step('markers', await am.$$eval('.leaflet-marker-icon', x => x.length));
await shot(am, {path: OUT + 'v3-admin-livemap-mobile.png'});
const a = await mk('ADMIN', D); await login(a, 'ankitcoolbindas@gmail.com', 'OwnerTest-123'); await a.evaluate(() => { location.hash = '#/map'; }); await a.waitForSelector('#mapslot'); await sleep(2500);
step('desktopMarkers', await a.$$eval('.leaflet-marker-icon', x => x.length)); await shot(a, {path: OUT + 'v3-admin-livemap.png'});
await a.evaluate(() => { location.hash = '#/activity'; }); await sleep(800); step('activityLink', await a.$$eval('a[href="#/map"]', x => x.map(e => e.innerText.trim())));
step('consoleErrors', errs); await b.close(); process.exit(0);
