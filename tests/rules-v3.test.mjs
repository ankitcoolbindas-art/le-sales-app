// v3 attendance / leave / payroll rules. Run with the Firestore emulator on 127.0.0.1:8080:
//   cd /workspace/le-sales-tools && node /workspace/le-sales-app/tests/rules-v3.test.mjs
import {initializeTestEnvironment, assertSucceeds, assertFails} from '@firebase/rules-unit-testing';
import {doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs, writeBatch, serverTimestamp} from 'firebase/firestore';
import fs from 'fs';
const env = await initializeTestEnvironment({projectId: 'le-sales-app', firestore: {rules: fs.readFileSync('/workspace/le-sales-app/firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080}});
await env.clearFirestore();
const results = []; let fail = 0;
const t = async (name, p) => { try { await p; results.push('PASS ' + name); } catch (e) { fail++; results.push('FAIL ' + name + ' :: ' + e.message.slice(0, 200)); } };
const ist = ms => new Date(ms + 330 * 60000).toISOString().slice(0, 10);
const TODAY = ist(Date.now()), YDAY = ist(Date.now() - 86400000), MONTH = TODAY.slice(0, 7);
const u = (name, role, active = true) => ({name, email: name + '@example.com', phone: '', role, territory: 'Ranchi', active, createdAt: Date.now(), createdBy: 'owner', mustChangePassword: false});
await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  await setDoc(doc(db, 'users/owner'), {...u('Owner', 'admin'), email: 'ankitcoolbindas@gmail.com'});
  for (const [id, r, a] of [['s1', 'sales', true], ['s2', 'sales', true], ['m1', 'manager', true], ['x1', 'sales', false]]) await setDoc(doc(db, 'users/' + id), u(id, r, a));
});
const ctx = id => env.authenticatedContext(id, {email: id + '@example.com'}).firestore();
const admin = ctx('owner'), s1 = ctx('s1'), s2 = ctx('s2'), m1 = ctx('m1'), x1 = ctx('x1'), stranger = ctx('nobody');
const IMG = 'data:image/jpeg;base64,' + 'A'.repeat(30000);
const photo = (uid, kind, date = TODAY, extra = {}) => ({uid, date, kind, img: IMG, ts: Date.now(), ...extra});
const inDoc = (uid, date = TODAY, extra = {}) => ({uid, name: uid, date, month: date.slice(0, 7), status: 'in', inAt: serverTimestamp(), inTs: Date.now(), inLat: 23.36, inLng: 85.32, inAcc: 12, inAddr: 'Main Road, Ranchi', inFlags: [], inSrc: 'web', createdAt: Date.now(), updatedAt: Date.now(), ...extra});
const outPatch = (extra = {}) => ({status: 'out', outAt: serverTimestamp(), outTs: Date.now(), outLat: 23.37, outLng: 85.33, outAcc: 20, outFlags: [], outSrc: 'web', hours: 8.5, updatedAt: Date.now(), ...extra});
const checkIn = (db, uid, date = TODAY, ex = {}, ph = {}, withPhoto = true) => { const b = writeBatch(db); if (withPhoto) b.set(doc(db, `attendancePhotos/${uid}_${date}_in`), photo(uid, 'in', date, ph)); b.set(doc(db, `attendance/${uid}_${date}`), inDoc(uid, date, ex)); return b.commit(); };
const checkOut = (db, uid, date = TODAY, ex = {}, withPhoto = true) => { const b = writeBatch(db); if (withPhoto) b.set(doc(db, `attendancePhotos/${uid}_${date}_out`), photo(uid, 'out', date)); b.update(doc(db, `attendance/${uid}_${date}`), outPatch(ex)); return b.commit(); };

// ---- check-in ----
await t('sales cannot check in without a selfie', assertFails(checkIn(s1, 's1', TODAY, {}, {}, false)));
await t('sales cannot check in for yesterday', assertFails(checkIn(s1, 's1', YDAY)));
await t('sales cannot check in as someone else', assertFails(checkIn(s1, 's2')));
await t('sales cannot backdate check-in time', assertFails(checkIn(s1, 's1', TODAY, {inTs: Date.now() - 3 * 3600000})));
await t('sales cannot use client clock for inAt', assertFails(checkIn(s1, 's1', TODAY, {inAt: Date.now()})));
await t('sales cannot add unknown fields (late=false)', assertFails(checkIn(s1, 's1', TODAY, {late: false})));
await t('photo must be a JPEG data URL', assertFails(checkIn(s1, 's1', TODAY, {}, {img: 'https://x/y.jpg'})));
await t('photo must be small (<150 KB)', assertFails(checkIn(s1, 's1', TODAY, {}, {img: 'data:image/jpeg;base64,' + 'A'.repeat(160000)})));
await t('sales checks in today with selfie + GPS', assertSucceeds(checkIn(s1, 's1')));
await t('sales cannot check in twice', assertFails(checkIn(s1, 's1')));
await t('sales cannot overwrite check-in photo', assertFails(setDoc(doc(s1, `attendancePhotos/s1_${TODAY}_in`), photo('s1', 'in'))));
await t('sales cannot edit check-in time', assertFails(updateDoc(doc(s1, `attendance/s1_${TODAY}`), {inTs: Date.now() - 3600000})));
await t('manager checks in (no GPS, flagged)', assertSucceeds((() => { const b = writeBatch(m1); b.set(doc(m1, `attendancePhotos/m1_${TODAY}_in`), photo('m1', 'in')); const {inLat, inLng, inAcc, inAddr, ...d} = inDoc('m1', TODAY, {inFlags: ['noGps']}); b.set(doc(m1, `attendance/m1_${TODAY}`), d); return b.commit(); })()));
await t('admin (owner) does not check in', assertFails(checkIn(admin, 'owner')));
await t('deactivated user cannot check in', assertFails(checkIn(x1, 'x1')));
await t('no-profile user cannot check in', assertFails(checkIn(stranger, 'nobody')));
// ---- check-out ----
await t('sales cannot check out without selfie', assertFails(checkOut(s1, 's1', TODAY, {}, false)));
await t('sales cannot change check-in fields while checking out', assertFails(checkOut(s1, 's1', TODAY, {inLat: 1})));
await t('sales checks out with selfie', assertSucceeds(checkOut(s1, 's1')));
await t('sales cannot check out twice', assertFails(checkOut(s1, 's1')));
await t('sales cannot edit after check-out', assertFails(updateDoc(doc(s1, `attendance/s1_${TODAY}`), {hours: 12, updatedAt: 1})));
await t('sales cannot delete attendance', assertFails(deleteDoc(doc(s1, `attendance/s1_${TODAY}`))));
await t('s2 cannot check out s1', assertFails(checkOut(s2, 's1')));
// ---- reads ----
await t('sales reads own attendance', assertSucceeds(getDoc(doc(s1, `attendance/s1_${TODAY}`))));
await t('sales lists own month', assertSucceeds(getDocs(query(collection(s1, 'attendance'), where('uid', '==', 's1'), where('month', '==', MONTH)))));
await t('sales cannot read other attendance', assertFails(getDoc(doc(s2, `attendance/s1_${TODAY}`))));
await t('sales cannot list all attendance', assertFails(getDocs(query(collection(s2, 'attendance'), where('month', '==', MONTH)))));
await t('sales reads own photo', assertSucceeds(getDoc(doc(s1, `attendancePhotos/s1_${TODAY}_in`))));
await t('sales cannot read other photo', assertFails(getDoc(doc(s2, `attendancePhotos/s1_${TODAY}_in`))));
await t('manager lists attendance for today', assertSucceeds(getDocs(query(collection(m1, 'attendance'), where('date', '==', TODAY)))));
await t('manager reads photo', assertSucceeds(getDoc(doc(m1, `attendancePhotos/s1_${TODAY}_in`))));
await t('nobody can list photos', assertFails(getDocs(collection(admin, 'attendancePhotos'))));
await t('deactivated user cannot read own attendance', assertFails(getDocs(query(collection(x1, 'attendance'), where('uid', '==', 'x1')))));
// ---- overrides ----
const ov = (extra = {}) => ({ovStatus: 'H', ovReason: 'Left early for site, approved', ovBy: 'owner', ovByName: 'Owner', ovAt: serverTimestamp(), ovFrom: 'P', updatedAt: Date.now(), ...extra});
await t('admin overrides with reason', assertSucceeds(updateDoc(doc(admin, `attendance/s1_${TODAY}`), ov())));
await t('admin override needs reason', assertFails(updateDoc(doc(admin, `attendance/s1_${TODAY}`), ov({ovReason: ''}))));
await t('admin cannot alter captured check-in time', assertFails(updateDoc(doc(admin, `attendance/s1_${TODAY}`), {...ov(), inTs: 1})));
await t('admin cannot hard delete attendance', assertFails(deleteDoc(doc(admin, `attendance/s1_${TODAY}`))));
await t('manager cannot override', assertFails(updateDoc(doc(m1, `attendance/s1_${TODAY}`), ov({ovBy: 'm1'}))));
await t('sales cannot override own day', assertFails(updateDoc(doc(s1, `attendance/s1_${TODAY}`), ov({ovBy: 's1', ovStatus: 'P'}))));
const ovNew = (uid, date) => ({uid, name: uid, date, month: date.slice(0, 7), status: 'none', ...ov({ovStatus: 'L', ovReason: 'Sick, informed by phone'}), createdAt: Date.now()});
await t('admin marks a past day (no check-in) with reason', assertSucceeds(setDoc(doc(admin, `attendance/s2_${YDAY}`), ovNew('s2', YDAY))));
await t('admin mark id must match uid_date', assertFails(setDoc(doc(admin, `attendance/s2_2020-01-01`), ovNew('s2', YDAY))));
await t('sales cannot create a marked day for self', assertFails(setDoc(doc(s2, `attendance/s2_${TODAY}`), {...ovNew('s2', TODAY), ovBy: 's2'})));
// ---- leaves ----
const lv = (uid, extra = {}) => ({uid, name: uid, from: TODAY, to: TODAY, days: 1, type: 'CL', reason: 'Family function', status: 'pending', createdAt: Date.now(), updatedAt: Date.now(), ...extra});
await t('sales requests leave', assertSucceeds(setDoc(doc(s2, 'leaves/l1'), lv('s2'))));
await t('sales cannot request approved leave', assertFails(setDoc(doc(s2, 'leaves/l2'), lv('s2', {status: 'approved'}))));
await t('sales cannot request leave for other', assertFails(setDoc(doc(s2, 'leaves/l3'), lv('s1'))));
await t('sales cannot approve own leave', assertFails(updateDoc(doc(s2, 'leaves/l1'), {status: 'approved', decidedBy: 's2'})));
await t('other sales cannot read leave', assertFails(getDoc(doc(s1, 'leaves/l1'))));
await t('manager reads leaves', assertSucceeds(getDocs(query(collection(m1, 'leaves'), where('status', '==', 'pending')))));
await t('manager cannot approve leave', assertFails(updateDoc(doc(m1, 'leaves/l1'), {status: 'approved', decidedBy: 'm1', decidedAt: Date.now()})));
await t('admin approves leave (paid)', assertSucceeds(updateDoc(doc(admin, 'leaves/l1'), {status: 'approved', paid: true, decidedBy: 'owner', decidedByName: 'Owner', decidedAt: Date.now(), updatedAt: Date.now()})));
await t('sales cannot cancel approved leave', assertFails(updateDoc(doc(s2, 'leaves/l1'), {status: 'cancelled', updatedAt: Date.now()})));
await t('sales withdraws own pending leave', assertSucceeds(setDoc(doc(s2, 'leaves/l4'), lv('s2')).then(() => updateDoc(doc(s2, 'leaves/l4'), {status: 'cancelled', updatedAt: Date.now()}))));
await t('nobody deletes leave', assertFails(deleteDoc(doc(admin, 'leaves/l1'))));
// ---- settings ----
const set = {start: '10:00', grace: 15, halfHours: 4, weekOff: [0], holidays: [{date: TODAY.slice(0, 4) + '-12-25', name: 'Christmas'}], basis: 'calendar', latePerHalf: 0, updatedAt: Date.now(), updatedBy: 'owner'};
await t('admin saves attendance settings', assertSucceeds(setDoc(doc(admin, 'settings/attendance'), set)));
await t('manager cannot change settings', assertFails(setDoc(doc(m1, 'settings/attendance'), set)));
await t('sales reads settings', assertSucceeds(getDoc(doc(s1, 'settings/attendance'))));
await t('admin cannot create other settings docs', assertFails(setDoc(doc(admin, 'settings/other'), set)));
// ---- salary ----
const sal = uid => ({uid, monthly: 15000, joinDate: '2026-11-01', designation: 'Sales Executive', updatedAt: Date.now(), updatedBy: 'owner'});
await t('admin sets salary', assertSucceeds(setDoc(doc(admin, 'salary/s1'), sal('s1'))));
await t('manager cannot read salary', assertFails(getDoc(doc(m1, 'salary/s1'))));
await t('sales cannot read own salary doc', assertFails(getDoc(doc(s1, 'salary/s1'))));
await t('manager cannot write salary', assertFails(setDoc(doc(m1, 'salary/s2'), sal('s2'))));
await t('salary doc id must match uid', assertFails(setDoc(doc(admin, 'salary/s2'), sal('s1'))));
// ---- payroll ----
const pay = (uid, status = 'draft', extra = {}) => ({uid, name: uid, month: MONTH, status, monthly: 15000, basis: 'calendar', daysInMonth: 30, workDays: 26, present: 24, half: 1, paidLeave: 1, unpaidLeave: 0, absent: 0, weekOffs: 4, holidays: 0, late: 2, lateCut: 0, notJoined: 0,
  paidDays: 29.5, perDay: 500, earned: 14750, incentive: 1000, allowance: 0, advance: 2000, deduction: 0, net: 13750, notes: '', createdAt: Date.now(), updatedAt: Date.now(), updatedBy: 'owner', ...extra});
await t('admin creates payroll draft', assertSucceeds(setDoc(doc(admin, `payroll/s1_${MONTH}`), pay('s1'))));
await t('sales cannot read own draft payslip', assertFails(getDoc(doc(s1, `payroll/s1_${MONTH}`))));
await t('manager cannot read payroll', assertFails(getDoc(doc(m1, `payroll/s1_${MONTH}`))));
await t('admin edits draft', assertSucceeds(updateDoc(doc(admin, `payroll/s1_${MONTH}`), {incentive: 1500, net: 14250, updatedAt: Date.now()})));
await t('admin finalizes', assertSucceeds(updateDoc(doc(admin, `payroll/s1_${MONTH}`), {status: 'finalized', finalizedAt: Date.now(), finalizedBy: 'owner'})));
await t('finalized payslip is locked', assertFails(updateDoc(doc(admin, `payroll/s1_${MONTH}`), {net: 99999})));
await t('finalized cannot go back to draft', assertFails(updateDoc(doc(admin, `payroll/s1_${MONTH}`), {status: 'draft'})));
await t('sales reads own finalized payslip', assertSucceeds(getDoc(doc(s1, `payroll/s1_${MONTH}`))));
await t('sales lists own finalized payslips', assertSucceeds(getDocs(query(collection(s1, 'payroll'), where('uid', '==', 's1'), where('status', '==', 'finalized')))));
await t('sales cannot list own payroll without finalized filter', assertFails(getDocs(query(collection(s1, 'payroll'), where('uid', '==', 's1')))));
await t('s2 cannot read s1 payslip', assertFails(getDoc(doc(s2, `payroll/s1_${MONTH}`))));
await t('sales cannot write payroll', assertFails(setDoc(doc(s2, `payroll/s2_${MONTH}`), pay('s2'))));
await t('payroll id must be uid_month', assertFails(setDoc(doc(admin, `payroll/s2_2020-01`), pay('s2'))));
await t('nobody deletes payroll', assertFails(deleteDoc(doc(admin, `payroll/s1_${MONTH}`))));
await t('deactivated user cannot read payslips', assertFails(getDocs(query(collection(x1, 'payroll'), where('uid', '==', 'x1'), where('status', '==', 'finalized')))));
// ---- v3.1 fake GPS points ----
const loc = (uid, extra = {}) => ({ownerUid: uid, ownerName: uid, lat: 23.36, lng: 85.32, accuracy: 10, ts: Date.now(), date: TODAY, source: 'android', reason: 'checkin-blocked', updatedAt: Date.now(), ...extra});
await t('sales writes a FAKE GPS point (mock + app name)', assertSucceeds(setDoc(doc(s1, 'locations/s1_mock1'), loc('s1', {mock: true, mockApp: 'Fake GPS Location'}))));
await t('mock must be boolean', assertFails(setDoc(doc(s1, 'locations/s1_mock2'), loc('s1', {mock: 'yes'}))));
await t('mockApp max 200 chars', assertFails(setDoc(doc(s1, 'locations/s1_mock3'), loc('s1', {mock: true, mockApp: 'x'.repeat(201)}))));
await t('lastLocation accepts mock flag', assertSucceeds(setDoc(doc(s1, 'lastLocation/s1'), loc('s1', {mock: true}))));
await t('manager lists today fake-GPS points', assertSucceeds(getDocs(query(collection(m1, 'locations'), where('date', '==', TODAY), where('mock', '==', true)))));
await t('sales cannot list fake-GPS points of others', assertFails(getDocs(query(collection(s2, 'locations'), where('mock', '==', true)))));
await t('sales cannot remove own mock flag (append-only)', assertFails(setDoc(doc(s1, 'locations/s1_mock1'), loc('s1', {mock: false}))));
console.log(results.join('\n')); console.log(`\n${results.length - fail}/${results.length} passed`);
await env.cleanup(); process.exit(fail ? 1 : 0);
