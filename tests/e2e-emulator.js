const puppeteer=require('puppeteer-core');
const B='http://localhost:8765/?emu=1', OUT='/workspace/le-sales-app/screens/', P='le-sales-app';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const res={}, errs=[];
const nav=async(p,r)=>{await p.evaluate(r=>{location.hash='#/'+r},r);await p.waitForFunction(r=>location.hash==='#/'+r&&document.querySelector('#view')&&document.querySelector('#view').children.length,{timeout:15000},r);await sleep(500)};
const step=(k,v)=>{res[k]=v;console.log('•',k,typeof v==='object'?JSON.stringify(v):v)};
(async()=>{
 await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${P}/databases/(default)/documents`,{method:'DELETE'});
 await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${P}/accounts`,{method:'DELETE'});
 const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:'new',args:['--no-sandbox','--disable-gpu']});
 const mk=async(name,vp)=>{const c=await b.createBrowserContext();await c.overridePermissions('http://localhost:8765',['geolocation']);const p=await c.newPage();
   p.on('pageerror',e=>errs.push(name+' PAGEERROR '+e.message));p.on('console',m=>{const t=m.text();if(m.type()==='error'&&!/PERMISSION_DENIED|permission|Missing or insufficient|ERR_|404|tile/i.test(t))errs.push(name+' '+t)});
   p.on('dialog',d=>d.accept());await p.evaluateOnNewDocument(()=>{try{localStorage.setItem('le_track_ms','5000')}catch(e){}});await p.setViewport(vp);return p};
 const dismiss=async p=>{await p.waitForSelector('.modal [data-close]',{timeout:4000}).then(async()=>{await sleep(200);await p.click('.modal .btn.pri[data-close], .modal [data-close]')}).catch(()=>{});await sleep(300)};
 const D={width:1440,height:900,deviceScaleFactor:1}, M={width:390,height:844,deviceScaleFactor:2,isMobile:true,hasTouch:true};
 // ---------- owner bootstrap ----------
 const a=await mk('ADMIN',D);
 await a.goto(B,{waitUntil:'networkidle0'});
 await a.waitForSelector('#af'); await a.screenshot({path:OUT+'v2-login-desktop.png'});
 await a.click('[data-am=setup]'); await a.waitForSelector('input[name=pw2]');
 await a.type('input[name=pw]','OwnerTest-123'); await a.type('input[name=pw2]','OwnerTest-123'); await a.click('#af button');
 await a.waitForSelector('#vf',{timeout:15000}); step('ownerAccountCreated','verify screen shown');
 // try continue before verifying -> should error
 await a.click('#vf button'); await a.waitForSelector('.err',{timeout:10000}); step('claimBeforeVerify',await a.$eval('.err',e=>e.textContent.slice(0,60)));
 const oob=await (await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${P}/oobCodes`)).json();
 const v=oob.oobCodes.find(o=>o.requestType==='VERIFY_EMAIL'); await fetch(v.oobLink); step('emailVerifiedVia','emulator oob link');
 await a.click('#vf button'); await a.waitForSelector('.side',{timeout:15000}); step('adminDashboard',await a.$eval('#ttl',e=>e.textContent));
 // ---------- admin adds employees ----------
 await nav(a,'team'); await a.click('[data-seg=tt][data-v=emp]'); await sleep(300);
 const addEmp=async(name,email,phone,terr,role)=>{await a.click('#addEmp');await a.waitForSelector('#ef');await a.type('#ef [name=name]',name);await a.type('#ef [name=email]',email);await a.type('#ef [name=phone]',phone);await a.type('#ef [name=territory]',terr);await a.select('#ef [name=role]',role);
   const pw=await a.$eval('#ef [name=password]',e=>e.value);await a.click('#ef .btn.pri');await a.waitForFunction(()=>document.querySelector('.modal .ok'),{timeout:15000});const msg=await a.$eval('.modal pre',e=>e.textContent);await a.click('.modal [data-close]');await sleep(300);return {pw,msg}};
 const e1=await addEmp('Rahul Kumar','rahul.test@example.com','9876500001','Ranchi Main Road','sales');
 const e2=await addEmp('Amit Singh','amit.test@example.com','9876500002','Kishoreganj','sales');
 const e3=await addEmp('Priya Manager','priya.test@example.com','9876500003','All Ranchi','manager');
 step('employeesCreated',await a.$$eval('tbody tr',r=>r.map(x=>x.innerText.replace(/\s+/g,' ').slice(0,70))));
 step('adminStillSignedIn',await a.evaluate(()=>DB.S.profile.email));
 await a.screenshot({path:OUT+'v2-admin-team-desktop.png'});
 // targets
 await a.click('[data-seg=tt][data-v=targets]'); await sleep(300);
 const setT=async(i,s,c,vv)=>{const rows=await a.$$('tr[data-trow]');const r=rows[i];for(const [n,val] of [['sales',s],['collection',c],['visits',vv]]){const inp=await r.$(`[name=${n}]`);await inp.click({clickCount:3});await inp.type(String(val));}await (await r.$('[data-tsave]')).click();await sleep(400)};
 await setT(0,600000,400000,50); await setT(1,300000,200000,0); await setT(2,800000,500000,60);
 step('targetsSaved',await a.evaluate(()=>DB.S.targets.size));
 // ---------- employee first login ----------
 const s=await mk('SALES',M); await s.setGeolocation({latitude:23.3615,longitude:85.3240,accuracy:14});
 await s.goto(B,{waitUntil:'networkidle0'}); await s.waitForSelector('#af');
 await s.screenshot({path:OUT+'v2-login-mobile.png'});
 await s.type('[name=email]','rahul.test@example.com'); await s.type('[name=pw]',e1.pw); await s.click('#af button');
 await s.waitForSelector('#cp',{timeout:15000}); step('forcedPasswordChange',true);
 await s.type('#cp [name=pw]','RahulNew-456'); await s.type('#cp [name=pw2]','RahulNew-456'); await s.click('#cp .btn.pri');
 await s.waitForSelector('.qa',{timeout:15000}); step('salesToday',await s.$eval('.hero h1',e=>e.textContent)); step('locationNoticeShown',await s.waitForSelector('#modal h3, #modal h2',{timeout:4000}).then(()=>s.$eval('#modal',e=>e.innerText.slice(0,40))).catch(()=>'FAIL')); await dismiss(s);
 // admin watches activity
 await nav(a,'activity'); await sleep(800);
 const seen=async name=>a.waitForFunction(n=>[...document.querySelectorAll('.li')].some(e=>e.textContent.includes(n)),{timeout:20000,polling:50},name);
 const lat={};
 // visit via UI
 await s.click('[data-new=visit]'); await s.waitForSelector('#gps.ok',{timeout:10000});
 await s.type('#f [name=customer]','Maa Bhadrakali Electricals'); await s.click('[data-chips=ctype] [data-v=Contractor]'); await s.type('#f [name=contact]','Sunil Ji'); await s.type('#f [name=phone]','9835012345');
 await s.type('#f [name=requirement]','MCB DBs for 12-flat site'); await s.type('#f [name=products]','Siemens MCB, C&S DB');
 await s.screenshot({path:OUT+'v2-sales-checkin-mobile.png'});
 let t0=Date.now(); await s.click('#f .btn.pri'); await seen('Maa Bhadrakali Electricals'); lat.visit=Date.now()-t0;
 // quote
 await s.click('[data-new=quote]'); await s.waitForSelector('#f'); await s.type('#f [name=customer]','Maa Bhadrakali Electricals'); await s.$eval('#f [name=customer]',e=>e.dispatchEvent(new Event('change')));
 await s.type('#f [name=value]','145000'); await s.click('[data-chips=status] [data-v=Hot]'); await s.$eval('#f [name=followUp]',e=>e.value=LE.today()); await s.type('#f [name=note]','Siemens MCB + DB, QT-118');
 t0=Date.now(); await s.click('#f .btn.pri'); await a.waitForFunction(()=>[...document.querySelectorAll('.li')].some(e=>e.textContent.includes('₹1,45,000')),{timeout:20000,polling:50}); lat.quote=Date.now()-t0;
 // collection
 await s.click('[data-new=payment]'); await s.waitForSelector('#f'); await s.type('#f [name=customer]','Ranjan Electric'); await s.type('#f [name=amount]','42000'); await s.click('[data-chips=mode] [data-v=UPI]'); await s.type('#f [name=ref]','UTR 556677');
 t0=Date.now(); await s.click('#f .btn.pri'); await seen('Ranjan Electric'); lat.payment=Date.now()-t0;
 // order
 await s.click('[data-new=order]'); await s.waitForSelector('#f'); await s.type('#f [name=customer]','Light India'); await s.type('#f [name=value]','68500'); await s.type('#f [name=items]','4 coils 2.5mm Finolex-type wire, 30 Kühl fans');
 t0=Date.now(); await s.click('#f .btn.pri'); await seen('Light India'); lat.order=Date.now()-t0;
 step('realtimeLatencyMs(emulator)',lat);
 await s.waitForFunction(()=>document.querySelector('#sync').textContent.includes('Live · synced'),{timeout:15000}).catch(()=>{});
 step('salesHeader',await s.$eval('#sync',e=>e.textContent));
 // offline queue
 await s.setOfflineMode(true); await sleep(500);
 await s.click('[data-new=payment]'); await s.waitForSelector('#f'); await s.type('#f [name=customer]','Offline Test Traders'); await s.type('#f [name=amount]','5000'); await s.click('#f .btn.pri'); await sleep(800);
 step('offlineQueued',{pending:await s.evaluate(()=>DB.pending().length),header:await s.$eval('#sync',e=>e.textContent)});
 t0=Date.now(); await s.setOfflineMode(false);
 await seen('Offline Test Traders'); step('offlineSyncedAfterReconnectMs',Date.now()-t0);
 await s.waitForFunction(()=>DB.pending().length===0,{timeout:20000}); step('pendingAfterReconnect',0);

 // ---------- live tracking ----------
 await s.waitForFunction(()=>DB.S.track.state==='on'&&DB.S.track.count>=1,{timeout:20000}).catch(()=>{});
 step('trackState',{state:await s.evaluate(()=>DB.S.track.state),count:await s.evaluate(()=>DB.S.track.count),pill:await s.$eval('#loc',e=>e.textContent),hero:await s.$eval('#trk',e=>e.textContent.slice(0,40)).catch(()=>'')});
 const rUid=await s.evaluate(()=>DB.S.user.uid);
 t0=Date.now(); await a.waitForFunction(u=>DB.S.lastLoc.has(u),{timeout:20000,polling:50},rUid).then(()=>step('adminSeesLastLocation',true)).catch(()=>step('adminSeesLastLocation','FAIL'));
 const c0=await s.evaluate(()=>DB.S.track.count);
 for(const [la,ln] of [[23.3660,85.3290],[23.3710,85.3330],[23.3760,85.3380]]){ await s.setGeolocation({latitude:la,longitude:ln,accuracy:12}); await sleep(3200); }
 await sleep(2500);
 step('pointsWrittenOnMovement',(await s.evaluate(()=>DB.S.track.count))-c0);
 t0=Date.now(); await a.waitForFunction(u=>{const l=DB.S.lastLoc.get(u);return l&&Math.abs(l.lat-23.376)<0.0005},{timeout:20000,polling:50},rUid).then(()=>step('adminLastLocationFollowsMoveMs',Date.now()-t0)).catch(()=>step('adminLastLocationFollowsMoveMs','FAIL'));
 step('routePointsVisibleToAdmin',await a.evaluate(async u=>(await DB.routeFor(u,LE.today())).length,rUid));
 step('lastLocDoc',await a.evaluate(u=>{const l=DB.S.lastLoc.get(u);return {source:l.source,reason:l.reason,acc:l.accuracy,hasDate:!!l.date}},rUid));
 // ---------- seed more history for realistic screenshots (rahul + amit) ----------
 const seed=async(p,arr)=>p.evaluate(arr=>{arr.forEach(x=>{const d=LE.addDays(LE.today(),-x.ago);const fu=x.fuo!=null?{followUp:LE.addDays(LE.today(),x.fuo)}:{};delete x.fuo;DB.save({...x,...fu,ago:undefined,date:d,ts:new Date(d+'T'+(x.t||'12:00')+':00').getTime()})})},arr);
 const H=[['Jagdamba Builders','Builder'],['Sai Electricals','Retailer'],['Ramsethu Infra','Contractor'],['A R Traders','Retailer'],['JMF Industries','Industry'],['Shree Ganesh Electric','Retailer'],['PWD Ranchi','Govt'],['Krishna Constructions','Builder']];
 const gen=(seedN,base)=>{const out=[];let k=seedN;const rnd=()=>{k=(k*9301+49297)%233280;return k/233280};
   for(let ago=13;ago>=0;ago--){const n=1+Math.floor(rnd()*3);for(let i=0;i<n;i++){const [c,ty]=H[Math.floor(rnd()*H.length)];const t=`${10+i*2}:${String(Math.floor(rnd()*50)+10)}`;
     out.push({kind:'visit',customer:c,ctype:ty,requirement:['Cables & wires','MCB / DB','LED lighting','Fans','Switchgear panel'][Math.floor(rnd()*5)],lat:base[0]+(rnd()-.5)*.06,lng:base[1]+(rnd()-.5)*.06,accuracy:10+Math.floor(rnd()*25),ago,t});
     if(rnd()<.45)out.push({kind:'quote',customer:c,value:Math.round(rnd()*250+20)*1000,status:['hot','warm','cold','won','lost','warm'][Math.floor(rnd()*6)],fuo:Math.floor(rnd()*12)-4,ago,t});
     if(rnd()<.4)out.push({kind:'order',customer:c,value:Math.round(rnd()*120+10)*1000,items:'Mixed electricals',ago,t});
     if(rnd()<.5)out.push({kind:'payment',customer:c,amount:Math.round(rnd()*90+5)*1000,mode:['Cash','UPI','Cheque','NEFT'][Math.floor(rnd()*4)],ago,t});}}return out};
 await seed(s,gen(7,[23.36,85.33]));
 const s2=await mk('SALES2',M); await s2.goto(B,{waitUntil:'networkidle0'}); await s2.waitForSelector('#af');
 await s2.type('[name=email]','amit.test@example.com'); await s2.type('[name=pw]',e2.pw); await s2.click('#af button'); await s2.waitForSelector('#cp'); await s2.type('#cp [name=pw]','AmitNew-789'); await s2.type('#cp [name=pw2]','AmitNew-789'); await s2.click('#cp .btn.pri'); await s2.waitForSelector('.qa'); await dismiss(s2);
 await seed(s2,gen(3,[23.40,85.30]));
 await s.waitForFunction(()=>DB.pending().length===0,{timeout:30000}); await s2.waitForFunction(()=>DB.pending().length===0,{timeout:30000});
 step('seeded',{rahul:await s.evaluate(()=>DB.S.records.size),amit:await s2.evaluate(()=>DB.S.records.size)});

 await s.evaluate(async()=>{const db=firebase.firestore(),u=DB.S.user.uid,t=LE.today();const v=[...DB.S.records.values()].filter(r=>r.kind==='visit'&&r.date===t&&r.lat!=null).sort((a,b)=>a.ts-b.ts);
   const base=new Date(t+'T09:30:00').getTime();let pts=[[23.3441,85.3096]];v.forEach(r=>pts.push([r.lat,r.lng]));const out=[];
   for(let i=1;i<pts.length;i++){const [a1,b1]=pts[i-1],[a2,b2]=pts[i];for(let k=0;k<8;k++){const f=k/8;out.push([a1+(a2-a1)*f+(Math.random()-.5)*.0015,b1+(b2-b1)*f+(Math.random()-.5)*.0015])}}
   const ll=DB.S.track.last;if(ll)out.push([ll.lat,ll.lng]);const ws=out.map((p,i)=>{const ts=Math.min(base+i*6*60000,Date.now()-(out.length-i)*6*60000-60000);return db.collection('locations').doc(u+'_seed'+i).set({ownerUid:u,ownerName:DB.S.profile.name,lat:p[0],lng:p[1],accuracy:15,ts,date:t,source:'web',reason:'interval',battery:0.82-i*0.004,charging:false,appVersion:'web-2',updatedAt:ts})});await Promise.all(ws)});
 await s2.evaluate(async()=>{await new Promise(r=>setTimeout(r,500))});
 // ---------- security checks from salesperson's own session (real rules) ----------
 const sec=await s.evaluate(async()=>{const db=firebase.firestore(),out={};const tr=async(k,f)=>{try{await f();out[k]='ALLOWED'}catch(e){out[k]='denied ('+e.code+')'}};
   const amitUid=(await (async()=>{try{return null}catch{}})());
   await tr('listAllUsers',()=>db.collection('users').get());
   await tr('listAllRecords',()=>db.collection('records').get());
   await tr('listOthersByDate',()=>db.collection('records').where('date','>=','2026-01-01').get());
   await tr('createUserDoc',()=>db.collection('users').doc('hacker').set({name:'x',email:'x@example.com',role:'admin',active:true}));
   await tr('promoteSelf',()=>db.collection('users').doc(DB.S.user.uid).update({role:'admin'}));
   await tr('writeTarget',()=>db.collection('targets').doc(DB.S.user.uid+'_2026-11').set({uid:DB.S.user.uid,month:'2026-11',sales:1,collection:1,visits:1}));
   await tr('hardDeleteOwn',()=>db.collection('records').doc([...DB.S.records.keys()][0]).delete());
   await tr('readOwnRecords',()=>db.collection('records').where('ownerUid','==',DB.S.user.uid).get());
   return out});
 const amitRecId=await s2.evaluate(()=>[...DB.S.records.keys()][0]), amitUid=await s2.evaluate(()=>DB.S.user.uid);
 Object.assign(sec,await s.evaluate(async(id,uid)=>{const db=firebase.firestore(),out={};const tr=async(k,f)=>{try{await f();out[k]='ALLOWED'}catch(e){out[k]='denied ('+e.code+')'}};
   await tr('readAmitRecord',()=>db.collection('records').doc(id).get()); await tr('listAmitRecords',()=>db.collection('records').where('ownerUid','==',uid).get());
   await tr('readAmitProfile',()=>db.collection('users').doc(uid).get()); await tr('editAmitRecord',()=>db.collection('records').doc(id).set({deleted:true},{merge:true}));return out},amitRecId,amitUid));
 Object.assign(sec,await s2.evaluate(async uid=>{const db=firebase.firestore(),out={};const tr=async(k,f)=>{try{await f();out[k]='ALLOWED'}catch(e){out[k]='denied ('+e.code+')'}};
   await tr('readRahulLastLocation',()=>db.collection('lastLocation').doc(uid).get()); await tr('listRahulLocations',()=>db.collection('locations').where('ownerUid','==',uid).get());
   await tr('listAllLastLocation',()=>db.collection('lastLocation').get()); await tr('writeLocationAsRahul',()=>db.collection('locations').doc('fake'+Date.now()).set({ownerUid:uid,lat:1,lng:1,accuracy:1,ts:1,date:'2026-11-25',source:'web'}));
   await tr('deleteOwnLocation',async()=>{const q=await db.collection('locations').where('ownerUid','==',DB.S.user.uid).limit(1).get();if(!q.docs.length)throw {code:'none-found'};await q.docs[0].ref.delete()});
   return out},await s.evaluate(()=>DB.S.user.uid)));
 Object.assign(sec,await s.evaluate(async()=>{const db=firebase.firestore(),out={};const q=await db.collection('locations').where('ownerUid','==',DB.S.user.uid).limit(1).get();out.ownLocations=q.size;
   try{await q.docs[0].ref.delete();out.deleteOwnLocation='ALLOWED'}catch(e){out.deleteOwnLocation='denied ('+e.code+')'}
   try{await q.docs[0].ref.update({lat:1});out.editOwnLocation='ALLOWED'}catch(e){out.editOwnLocation='denied ('+e.code+')'}
   try{await db.collection('lastLocation').doc(DB.S.user.uid).delete();out.deleteOwnLastLocation='ALLOWED'}catch(e){out.deleteOwnLastLocation='denied ('+e.code+')'}return out}));
 step('salesSecurity',sec);
 // manager can read all, cannot create users
 const mg=await mk('MGR',D); await mg.goto(B,{waitUntil:'networkidle0'}); await mg.waitForSelector('#af');
 await mg.type('[name=email]','priya.test@example.com'); await mg.type('[name=pw]',e3.pw); await mg.click('#af button'); await mg.waitForSelector('#cp'); await mg.type('#cp [name=pw]','PriyaNew-111'); await mg.type('#cp [name=pw2]','PriyaNew-111'); await mg.click('#cp .btn.pri'); await mg.waitForSelector('.side');
 await sleep(1500);
 step('managerSees',await mg.evaluate(async()=>{const db=firebase.firestore();let cu='?';try{await db.collection('users').doc('x1').set({name:'x',email:'x@example.com',role:'sales',active:true});cu='ALLOWED'}catch(e){cu='denied ('+e.code+')'}
   return {records:DB.S.records.size,users:DB.S.users.size,addEmployeeButton:!!document.querySelector('#addEmp'),createUserDoc:cu}}));
 // ---------- screenshots ----------
 await nav(s,'today'); await s.waitForSelector('.qa'); await sleep(800);
 await s.screenshot({path:OUT+'v2-sales-today-mobile.png'});
 await s.screenshot({path:OUT+'v2-sales-today-mobile-full.png',fullPage:true});
 step('trackBeforeShot',await s.evaluate(()=>JSON.stringify({st:DB.S.track.state,err:DB.S.track.err,c:DB.S.track.count}))); await s.click('#loc'); await sleep(400); await s.screenshot({path:OUT+'v2-sales-location-mobile.png'}); await s.click('.modal [data-close]'); await sleep(200);
 await s.click('[data-act=report]'); await s.waitForSelector('#repText'); step('reportStarts',await s.$eval('#repText',e=>e.textContent.split('\n').slice(0,6).join(' | ')));
 step('waLink',(await s.$eval('#waSend',e=>e.href)).slice(0,60));
 await s.screenshot({path:OUT+'v2-sales-report-mobile.png'}); await s.click('.modal [data-close]');
 await nav(s,'quotes'); await sleep(600); await s.screenshot({path:OUT+'v2-sales-quotes-mobile.png'});
 await nav(s,'customers'); await sleep(600); await s.click('[data-cust]'); await sleep(1200); await s.screenshot({path:OUT+'v2-sales-customer-mobile.png'});
 step('salesCustomerHistory',await s.$eval('.card-h .sub',e=>e.textContent).catch(()=>'?'));
 await nav(a,'dashboard'); await sleep(1000); await a.click('[data-seg=per][data-v=month]'); await sleep(2500);
 await a.screenshot({path:OUT+'v2-admin-dashboard-desktop.png'}); await a.screenshot({path:OUT+'v2-admin-dashboard-desktop-full.png',fullPage:true});
 step('dashKPIs',await a.$$eval('.kpi',k=>k.map(x=>x.querySelector('.l').textContent+': '+x.querySelector('.v').textContent)));
 for(const [r,f] of [['pipeline','v2-admin-pipeline-desktop'],['calendar','v2-admin-calendar-desktop'],['records','v2-admin-records-desktop'],['customers','v2-admin-customers-desktop']]){await nav(a,r);await sleep(r==='map'?3500:900);await a.screenshot({path:OUT+f+'.png'});}
 await nav(a,'team'); await sleep(800); await a.screenshot({path:OUT+'v2-admin-targets-desktop.png'});
 await a.evaluate(()=>{UI.st.q.mm='live'}); await nav(a,'dashboard'); await nav(a,'map'); await sleep(3500); await a.screenshot({path:OUT+'v2-admin-live-desktop.png'});
 step('liveListRows',await a.$$eval('.dash .li',l=>l.map(x=>x.innerText.replace(/\s+/g,' ').slice(0,70))));
 await a.click('[data-seg=mm][data-v=route]'); await sleep(2500); await a.screenshot({path:OUT+'v2-admin-route-desktop.png'}); step('routeInfo',await a.$eval('.page-h p',e=>e.textContent));
 await a.click('[data-seg=mm][data-v=visits]'); await sleep(2500); await a.screenshot({path:OUT+'v2-admin-map-desktop.png'}); await a.click('[data-seg=mm][data-v=live]');
 // admin mobile
 const am=await a.browserContext().newPage(); await am.setViewport(M); await am.goto(B+'#/dashboard',{waitUntil:'domcontentloaded'}); await am.waitForSelector('.kpi',{timeout:20000}); await sleep(3000); await am.screenshot({path:OUT+'v2-admin-dashboard-mobile.png'});
 await nav(am,'pipeline'); await sleep(800); await am.screenshot({path:OUT+'v2-admin-pipeline-mobile.png'});  await am.evaluate(()=>{UI.st.q.mm='live';location.hash='#/map'}); await sleep(3500); await am.screenshot({path:OUT+'v2-admin-live-mobile.png'}); await am.close();
 // admin moves a quote via kanban select (admin can edit others)
 await nav(a,'pipeline'); await sleep(600);
 const mv=await a.$('[data-move]'); const mvId=await a.$eval('[data-move]',e=>e.dataset.move); await a.select(`[data-move="${mvId}"]`,'won'); await sleep(1500);
 step('adminMovedQuote',await s.evaluate(id=>(DB.S.records.get(id)||{}).status,mvId).catch(()=>'n/a (other rep)') );
 // ---------- deactivate Rahul ----------
 await nav(a,'team'); await a.click('[data-seg=tt][data-v=emp]'); await sleep(300);
 const rahulUid=await s.evaluate(()=>DB.S.user.uid); await a.click(`[data-etoggle="${rahulUid}"]`); await sleep(400);
 await s.waitForFunction(()=>document.body.innerText.includes('Account deactivated'),{timeout:15000}).then(()=>step('deactivatedBlockedLive','blocked screen shown on his phone')).catch(()=>step('deactivatedBlockedLive','FAIL'));
 step('trackerStoppedOnDeactivate',await s.evaluate(()=>DB.S.track.state));
 step('deactivatedWrite',await s.evaluate(async()=>{try{await firebase.firestore().collection('records').doc('zz'+Date.now()).set({id:'x',kind:'visit',ownerUid:DB.S.user.uid,date:LE.today(),ts:Date.now(),customer:'X'});return 'ALLOWED'}catch(e){return 'denied ('+e.code+')'}}));
 await s.screenshot({path:OUT+'v2-sales-deactivated-mobile.png'});
 // re-login after deactivation
 const s3=await mk('SALES3',M); await s3.goto(B,{waitUntil:'domcontentloaded'}); await s3.waitForSelector('#af'); await s3.type('[name=email]','rahul.test@example.com'); await s3.type('[name=pw]','RahulNew-456'); await s3.click('#af button');
 await s3.waitForFunction(()=>document.body.innerText.includes('Account deactivated'),{timeout:15000}).then(()=>step('deactivatedRelogin','blocked')).catch(()=>step('deactivatedRelogin','FAIL'));
 // outsider self-signup
 const o=await mk('OUT',M); await o.goto(B,{waitUntil:'domcontentloaded'}); await o.waitForSelector('#af');
 step('selfSignup',await o.evaluate(async()=>{const c=await firebase.auth().createUserWithEmailAndPassword('outsider@example.com','Outsider-123');await new Promise(r=>setTimeout(r,1500));let w;try{await firebase.firestore().collection('users').doc(c.user.uid).set({name:'o',email:'outsider@example.com',role:'admin',active:true});w='ALLOWED'}catch(e){w='denied ('+e.code+')'}return {screen:document.body.innerText.slice(0,40).replace(/\n/g,' '),selfAdmin:w}}));
 await nav(a,'team'); await a.click('[data-seg=tt][data-v=emp]'); await sleep(400); await a.screenshot({path:OUT+'v2-admin-employees-desktop.png'});
 console.log('\nERRORS',JSON.stringify(errs,null,1));
 require('fs').writeFileSync('/workspace/le-sales-tools/e2e-result.json',JSON.stringify({res,errs},null,1));
 await b.close();
})().catch(e=>{console.error('TEST CRASH',e);console.log('ERRORS',JSON.stringify(errs,null,1));process.exit(1)});
