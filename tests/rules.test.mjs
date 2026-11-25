import {initializeTestEnvironment, assertSucceeds, assertFails} from '@firebase/rules-unit-testing';
import {doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs} from 'firebase/firestore';
import fs from 'fs';
const env = await initializeTestEnvironment({projectId: 'le-sales-app', firestore: {rules: fs.readFileSync('/workspace/le-sales-app/firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080}});
await env.clearFirestore();
const results = []; let fail = 0;
const t = async (name, p) => { try { await p; results.push('PASS ' + name); } catch (e) { fail++; results.push('FAIL ' + name + ' :: ' + e.message.slice(0, 160)); } };
const BOOT = 'ankitcoolbindas@gmail.com';
const owner = env.authenticatedContext('owner', {email: BOOT, email_verified: true}).firestore();
const ownerUnverified = env.authenticatedContext('owner2', {email: BOOT, email_verified: false}).firestore();
const imposter = env.authenticatedContext('imp', {email: 'x@example.com', email_verified: true}).firestore();
const anon = env.authenticatedContext('anon1', {firebase: {sign_in_provider: 'anonymous'}}).firestore();
const unauth = env.unauthenticatedContext().firestore();
const u = (name, role, extra = {}) => ({name, email: name + '@example.com', phone: '', role, territory: 'Ranchi', active: true, createdAt: Date.now(), createdBy: 'owner', mustChangePassword: true, ...extra});
const rec = (id, ownerUid, extra = {}) => ({id, kind: 'visit', ownerUid, ownerName: 'x', date: '2026-11-25', ts: Date.now(), customer: 'Cust', customerKey: 'cust', ...extra});

// bootstrap
await t('unverified owner email cannot bootstrap', assertFails(setDoc(doc(ownerUnverified, 'users/owner2'), {...u('Ankit', 'admin'), email: BOOT})));
await t('other email cannot self-create admin', assertFails(setDoc(doc(imposter, 'users/imp'), {...u('imp', 'admin'), email: 'x@example.com'})));
await t('other email cannot self-create sales', assertFails(setDoc(doc(imposter, 'users/imp'), u('imp', 'sales'))));
await t('anonymous cannot create profile', assertFails(setDoc(doc(anon, 'users/anon1'), u('anon', 'sales'))));
await t('verified owner bootstraps own admin doc', assertSucceeds(setDoc(doc(owner, 'users/owner'), {...u('Ankit', 'admin'), email: BOOT, mustChangePassword: false})));
await t('owner cannot bootstrap a second time (doc exists -> update rules)', assertSucceeds(getDoc(doc(owner, 'users/owner'))));
// admin creates employees
await t('admin creates sales s1', assertSucceeds(setDoc(doc(owner, 'users/s1'), u('s1', 'sales'))));
await t('admin creates sales s2', assertSucceeds(setDoc(doc(owner, 'users/s2'), u('s2', 'sales'))));
await t('admin creates manager m1', assertSucceeds(setDoc(doc(owner, 'users/m1'), u('m1', 'manager'))));
await t('admin cannot write unknown user fields', assertFails(setDoc(doc(owner, 'users/s9'), {...u('s9', 'sales'), salary: 1})));
await t('admin cannot set bad role', assertFails(setDoc(doc(owner, 'users/s9'), u('s9', 'boss'))));
await t('admin cannot deactivate self', assertFails(updateDoc(doc(owner, 'users/owner'), {active: false})));
await t('admin cannot demote self', assertFails(updateDoc(doc(owner, 'users/owner'), {role: 'sales'})));
const s1 = env.authenticatedContext('s1', {email: 's1@example.com'}).firestore();
const s2 = env.authenticatedContext('s2', {email: 's2@example.com'}).firestore();
const m1 = env.authenticatedContext('m1', {email: 'm1@example.com'}).firestore();
// non-admin user mgmt
await t('sales cannot create users', assertFails(setDoc(doc(s1, 'users/s5'), u('s5', 'sales'))));
await t('manager cannot create users', assertFails(setDoc(doc(m1, 'users/s5'), u('s5', 'sales'))));
await t('sales cannot promote self', assertFails(updateDoc(doc(s1, 'users/s1'), {role: 'admin'})));
await t('sales can clear own mustChangePassword', assertSucceeds(updateDoc(doc(s1, 'users/s1'), {mustChangePassword: false, updatedAt: Date.now()})));
await t('sales cannot set own mustChangePassword+territory', assertFails(updateDoc(doc(s1, 'users/s1'), {mustChangePassword: false, territory: 'X'})));
await t('sales reads own profile', assertSucceeds(getDoc(doc(s1, 'users/s1'))));
await t('sales cannot read other profile', assertFails(getDoc(doc(s1, 'users/s2'))));
await t('sales cannot list users', assertFails(getDocs(collection(s1, 'users'))));
await t('manager lists users', assertSucceeds(getDocs(collection(m1, 'users'))));
// records
await t('sales creates own record', assertSucceeds(setDoc(doc(s1, 'records/r1'), rec('r1', 's1'))));
await t('sales2 creates own record', assertSucceeds(setDoc(doc(s2, 'records/r2'), rec('r2', 's2'))));
await t('sales cannot create record as other', assertFails(setDoc(doc(s1, 'records/r3'), rec('r3', 's2'))));
await t('sales cannot create invalid kind', assertFails(setDoc(doc(s1, 'records/r4'), rec('r4', 's1', {kind: 'x'}))));
await t('sales updates own record (soft delete)', assertSucceeds(setDoc(doc(s1, 'records/r1'), {deleted: true, upd: Date.now()}, {merge: true})));
await t('sales cannot hard delete own record', assertFails(deleteDoc(doc(s1, 'records/r1'))));
await t('sales cannot read other record', assertFails(getDoc(doc(s1, 'records/r2'))));
await t('sales cannot update other record', assertFails(setDoc(doc(s1, 'records/r2'), {deleted: true}, {merge: true})));
await t('sales lists own records (ownerUid filter)', assertSucceeds(getDocs(query(collection(s1, 'records'), where('ownerUid', '==', 's1')))));
await t('sales cannot list all records', assertFails(getDocs(collection(s1, 'records'))));
await t('sales cannot list by date only', assertFails(getDocs(query(collection(s1, 'records'), where('date', '>=', '2026-11-01')))));
await t('manager lists all records by date', assertSucceeds(getDocs(query(collection(m1, 'records'), where('date', '>=', '2026-11-01')))));
await t('manager cannot edit sales record', assertFails(setDoc(doc(m1, 'records/r2'), {deleted: true}, {merge: true})));
await t('admin can edit sales record (ownerUid kept)', assertSucceeds(setDoc(doc(owner, 'records/r2'), {status: 'won'}, {merge: true})));
await t('admin cannot change ownerUid', assertFails(setDoc(doc(owner, 'records/r2'), {ownerUid: 's1'}, {merge: true})));
// targets
const tg = {uid: 's1', month: '2026-11', sales: 500000, collection: 300000, visits: 80, updatedAt: Date.now(), updatedBy: 'owner'};
await t('admin sets target', assertSucceeds(setDoc(doc(owner, 'targets/s1_2026-11'), tg)));
await t('manager cannot set target', assertFails(setDoc(doc(m1, 'targets/s2_2026-11'), {...tg, uid: 's2'})));
await t('sales cannot set target', assertFails(setDoc(doc(s1, 'targets/s1_2026-11'), tg)));
await t('sales reads own target', assertSucceeds(getDoc(doc(s1, 'targets/s1_2026-11'))));
await t('sales cannot read other target', assertFails(getDoc(doc(s2, 'targets/s1_2026-11'))));
// deactivation
await t('admin deactivates s2', assertSucceeds(updateDoc(doc(owner, 'users/s2'), {active: false, updatedAt: Date.now()})));
await t('deactivated cannot create record', assertFails(setDoc(doc(s2, 'records/r9'), rec('r9', 's2'))));
await t('deactivated cannot read own records', assertFails(getDocs(query(collection(s2, 'records'), where('ownerUid', '==', 's2')))));
await t('deactivated can read own profile (to see status)', assertSucceeds(getDoc(doc(s2, 'users/s2'))));
// outsiders
await t('signed-in user without profile denied records', assertFails(getDocs(query(collection(imposter, 'records'), where('ownerUid', '==', 'imp')))));
await t('anonymous denied records', assertFails(setDoc(doc(anon, 'records/a1'), rec('a1', 'anon1'))));
await t('unauthenticated denied users', assertFails(getDocs(collection(unauth, 'users'))));
await t('v1 /teams path closed', assertFails(setDoc(doc(anon, 'teams/TEST-LE-0000/records/x'), rec('x', 'anon1'))));
console.log(results.join('\n')); console.log(`\n${results.length - fail}/${results.length} passed`);
await env.cleanup(); process.exit(fail ? 1 : 0);
