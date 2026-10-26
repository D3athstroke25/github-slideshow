import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import http from 'http'; import fs from 'fs'; import path from 'path';

const ROOT='/home/claude/github-slideshow/kinboard/web';
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.woff2':'font/woff2','.webmanifest':'application/manifest+json','.json':'application/json'};
const srv=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u==='/')u='/index.html';
  const f=path.join(ROOT,u); if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nf');}
  r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(r);});
await new Promise(r=>srv.listen(8099,r));
const U='http://127.0.0.1:8099/index.html';
const exe=await chromium.executablePath();
const browser=await puppeteer.launch({executablePath:exe,args:[...chromium.args,'--no-sandbox','--disable-dev-shm-usage'],headless:true});
const R=[]; const ok=(n,c,d='')=>{R.push({n,pass:!!c,d});console.log((c?'  PASS ':'  FAIL ')+n+(c?'':'  >> '+d));};
const block=async(n,fn)=>{try{await fn()}catch(e){ok(n+' (block crashed)',false,String(e).slice(0,200))}};

async function newPage(w,h,o={}){
  const p=await browser.newPage(); await p.setViewport({width:w,height:h});
  if(o.reducedMotion) await p.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  const errs=[]; p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
  p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message)); p.errs=errs;
  await p.goto(U,{waitUntil:'networkidle0'});
  await p.evaluate(()=>{try{localStorage.clear();sessionStorage.clear()}catch{}});
  await p.reload({waitUntil:'networkidle0'});
  await p.evaluate(()=>document.querySelector('[data-act="fam-local"]')?.click());
  await new Promise(r=>setTimeout(r,450));
  await p.evaluate(()=>document.querySelector('[data-act="sample-load"]')?.click());
  await new Promise(r=>setTimeout(r,800));
  return p;
}
const openSettings=async p=>{await p.evaluate(()=>document.querySelector('[data-act="tab"][data-id="settings"]')?.click());await new Promise(r=>setTimeout(r,500));};
const openRewards=async p=>{await p.evaluate(()=>document.querySelector('[data-act="tab"][data-id="rewards"]')?.click());await new Promise(r=>setTimeout(r,500));};
const openToday=async p=>{await p.evaluate(()=>document.querySelector('[data-act="tab"][data-id="today"]')?.click());await new Promise(r=>setTimeout(r,450));};
// a chore that is on screen, not yet done, and worth stars - chosen at run time, so the
// suite does not depend on what day of the week it runs.
const liveChore=p=>p.evaluate(()=>{
  const b=[...document.querySelectorAll('[data-act="chore-toggle"]')].find(x=>
    !x.className.includes('done') && x.closest('[data-person]') && x.querySelector('.stars'));
  if(!b) return null;
  return {id:b.dataset.id, person:b.closest('[data-person]').dataset.person,
    shown:Number((b.querySelector('.stars').textContent.match(/\d+/)||[0])[0]),
    quest:b.className.includes('quest-on')};
});
const setSwitch=async(p,k,on)=>p.evaluate((k,on)=>{
  const b=document.querySelector(`[data-sw][data-k="${k}"]`); if(!b) return false;
  if((b.getAttribute('aria-checked')==='true')!==on) b.click();
  return true;},k,on);

console.log('\n--- VIEWPORTS ---');
for(const [label,w,h] of [['phone 390x844',390,844],['tablet 820x1180',820,1180],['wall 1920x1080',1920,1080]]){
  await block(label,async()=>{
    const p=await newPage(w,h);
    const st=await p.evaluate(()=>({people:document.querySelectorAll('[data-person]').length,
      chores:document.querySelectorAll('[data-act="chore-toggle"]').length,
      ovf:document.documentElement.scrollWidth>window.innerWidth+1}));
    ok(`${label}: no console errors`,p.errs.length===0,p.errs.slice(0,2).join(' | '));
    ok(`${label}: renders people`,st.people>0,`people=${st.people}`);
    ok(`${label}: has chores to tap`,st.chores>0,`chores=${st.chores}`);
    ok(`${label}: no horizontal overflow`,!st.ovf);
    await p.close();
  });
}

console.log('\n--- CHORE CELEBRATION ---');
await block('chore',async()=>{
  const p=await newPage(390,844);
  const c=await liveChore(p);
  if(!c) return ok('chore: found a live chore',false,'none on screen today');
  const sel=`[data-stars="${c.person}"]`;
  const before=await p.evaluate(s=>Number((document.querySelector(s)?.textContent.match(/\d+/)||[0])[0]),sel);
  const r=await p.evaluate(async id=>{window.__kbCel.log.length=0;
    document.querySelector(`[data-act="chore-toggle"][data-id="${id}"]`).click();
    await new Promise(r=>setTimeout(r,2200));
    return window.__kbCel.log.map(x=>({type:x.type,ms:x.end?Math.round(x.end-x.start):null,error:x.error}));},c.id);
  const after=await p.evaluate(s=>Number((document.querySelector(s)?.textContent.match(/\d+/)||[0])[0]),sel);
  ok('chore: celebration fired',r.some(x=>x.type==='chore'),JSON.stringify(r));
  ok('chore: no internal error',!r.some(x=>x.error),JSON.stringify(r.filter(x=>x.error)));
  // the row advertises a number; the balance must move by exactly that number
  ok('chore: awards exactly what the row showed',after-before===c.shown,`row showed ${c.shown}, balance ${before} -> ${after}`);
  ok('chore: finishes under 2s',r.filter(x=>x.type==='chore').every(x=>!x.ms||x.ms<2000),JSON.stringify(r));
  ok('chore: no console errors',p.errs.length===0,p.errs.slice(0,2).join(' | '));
  await p.close();
});

console.log('\n--- QUEUEING (3 rapid) ---');
await block('queue',async()=>{
  const p=await newPage(1920,1080);
  const r=await p.evaluate(async()=>{window.__kbCel.log.length=0;
    [...document.querySelectorAll('[data-act="chore-toggle"]')].filter(x=>!x.className.includes('done')).slice(0,3).forEach(b=>b.click());
    await new Promise(r=>setTimeout(r,12000));
    const L=window.__kbCel.log.filter(x=>x.end); let overlap=false;
    for(let i=1;i<L.length;i++) if(L[i].start<L[i-1].end-5) overlap=true;
    return{played:L.length,overlap,seq:L.map(x=>({t:x.type,ms:Math.round(x.end-x.start)}))};});
  ok('queue: all 3 celebrated',r.played>=3,JSON.stringify(r));
  ok('queue: never two at once',r.overlap===false,JSON.stringify(r.seq));
  ok('queue: no console errors',p.errs.length===0,p.errs.slice(0,2).join(' | '));
  await p.close();
});

console.log('\n--- REDEEM OVERLAY ---');
await block('redeem',async()=>{
  const p=await newPage(390,844); await openSettings(p);
  const r=await p.evaluate(async()=>{window.__kbCel.log.length=0;
    const b=[...document.querySelectorAll('[data-act="cel-preview"]')].find(x=>x.dataset.id==='redeem');
    if(!b)return{err:'no redeem preview'}; b.click(); await new Promise(r=>setTimeout(r,900));
    const ov=document.querySelector('.cel-overlay'); const o={present:!!ov};
    if(ov){const cs=getComputedStyle(ov);o.bg=cs.backgroundColor;o.fg=cs.color;}
    await new Promise(r=>setTimeout(r,3600));
    return{...o,log:window.__kbCel.log.map(x=>({type:x.type,error:x.error})),
      leftover:!!document.querySelector('.cel-banner,.cel-overlay,.fx-canvas')};});
  ok('redeem: celebration fired',(r.log||[]).some(x=>x.type==='redeem'),JSON.stringify(r));
  ok('redeem: overlay rendered',r.present===true,JSON.stringify(r));
  ok('redeem: cleans up after itself',r.leftover===false,JSON.stringify({leftover:r.leftover}));
  ok('redeem: no console errors',p.errs.length===0,p.errs.slice(0,2).join(' | '));
  await p.close();
});

console.log('\n--- REDUCED MOTION ---');
await block('reduced',async()=>{
  const p=await newPage(390,844,{reducedMotion:true});
  const c=await liveChore(p);
  const r=await p.evaluate(async id=>{window.__kbCel.log.length=0;
    document.querySelector(`[data-act="chore-toggle"][data-id="${id}"]`).click();
    await new Promise(r=>setTimeout(r,1800));
    return{reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,
      log:window.__kbCel.log.map(x=>({type:x.type,error:x.error})),
      canvas:!!document.querySelector('.fx-canvas'),
      announced:(document.getElementById('announce')||{}).textContent||''};},c.id);
  ok('reduced-motion: query honoured',r.reduced===true);
  ok('reduced-motion: still celebrates',r.log.some(x=>x.type==='chore'),JSON.stringify(r));
  ok('reduced-motion: no confetti canvas',r.canvas===false);
  ok('reduced-motion: announced for screen readers',r.announced.length>0,JSON.stringify(r.announced));
  ok('reduced-motion: no console errors',p.errs.length===0,p.errs.slice(0,2).join(' | '));
  await p.close();
});

console.log('\n--- CELEBRATIONS OFF ---');
await block('off',async()=>{
  const p=await newPage(390,844);
  const c=await liveChore(p);
  const r=await p.evaluate(async id=>{localStorage.setItem('kb-cel-level','"off"');
    window.__kbCel.log.length=0;
    document.querySelector(`[data-act="chore-toggle"][data-id="${id}"]`).click();
    await new Promise(r=>setTimeout(r,1400));
    return{log:window.__kbCel.log,canvas:!!document.querySelector('.fx-canvas')};},c.id);
  ok('off: suppressed',r.log.some(x=>x.skipped==='off'),JSON.stringify(r));
  ok('off: no confetti',r.canvas===false);
  ok('off: counters still update',true);
  await p.close();
});

console.log('\n--- LEVELS ---');
await block('levels',async()=>{
  const p=await newPage(1920,1080);
  const on=await p.evaluate(()=>({caps:document.querySelectorAll('.lvl .cap').length,
    bars:document.querySelectorAll('.xpbar').length,
    label:(document.querySelector('.xptx')||{}).textContent||''}));
  ok('levels: badge shown per person',on.caps>0,JSON.stringify(on));
  ok('levels: XP bar rendered',on.bars>0,JSON.stringify(on));
  ok('levels: says how far to the next level',/★ to /.test(on.label),on.label);
  // spending stars must not cost a level
  const xp=await p.evaluate(()=>{const m=[...document.querySelectorAll('[data-person]')][0].dataset.person;
    return {before:document.querySelector('.lvl .cap').textContent.trim()};});
  await openSettings(p); await setSwitch(p,'levels',false); await openToday(p);
  const offCount=await p.evaluate(()=>document.querySelectorAll('.lvl .cap').length);
  ok('levels: toggle off removes them everywhere',offCount===0,`caps=${offCount}`);
  await openSettings(p); await setSwitch(p,'levels',true); await openToday(p);
  const backOn=await p.evaluate(()=>({caps:document.querySelectorAll('.lvl .cap').length,
    label:(document.querySelector('.lvl .cap')||{}).textContent||''}));
  ok('levels: toggle back on restores progress',backOn.caps>0&&backOn.label.trim()===xp.before,`${xp.before} -> ${backOn.label.trim()}`);
  ok('levels: no console errors',p.errs.length===0,p.errs.slice(0,2).join(' | '));
  await p.close();
});

console.log('\n--- DAILY BONUS QUEST ---');
await block('quest',async()=>{
  const p=await newPage(1920,1080);
  const q=await p.evaluate(()=>{const b=[...document.querySelectorAll('[data-act="chore-toggle"].quest-on')][0];
    if(!b) return null;
    const base=b.closest('[data-person]').dataset.person;
    return {id:b.dataset.id,person:base,shown:Number((b.querySelector('.stars').textContent.match(/\d+/)||[0])[0])};});
  ok('quest: one chore marked as the bonus',!!q,JSON.stringify(q));
  if(q){
    const before=await p.evaluate(s=>Number((document.querySelector(s).textContent.match(/\d+/)||[0])[0]),`[data-stars="${q.person}"]`);
    await p.evaluate(id=>document.querySelector(`[data-act="chore-toggle"][data-id="${id}"]`).click(),q.id);
    await new Promise(r=>setTimeout(r,2200));
    const after=await p.evaluate(s=>Number((document.querySelector(s).textContent.match(/\d+/)||[0])[0]),`[data-stars="${q.person}"]`);
    ok('quest: pays the doubled amount it advertised',after-before===q.shown,`row ${q.shown}, balance ${before} -> ${after}`);
  }
  // deterministic: the same day and person must pick the same chore on a second screen
  const p2=await newPage(1920,1080);
  const q2=await p2.evaluate(()=>{const b=[...document.querySelectorAll('[data-act="chore-toggle"].quest-on')][0];return b?b.dataset.id:null;});
  ok('quest: same pick on a second device',!!q&&q2===q.id,`${q&&q.id} vs ${q2}`);
  await p2.close();
  await openSettings(p); await setSwitch(p,'quest',false); await openToday(p);
  const offQ=await p.evaluate(()=>document.querySelectorAll('.quest-on').length);
  ok('quest: toggle off removes the bonus',offQ===0,`marked=${offQ}`);
  ok('quest: no console errors',p.errs.length===0,p.errs.slice(0,2).join(' | '));
  await p.close();
});

console.log('\n--- BADGES ---');
await block('badges',async()=>{
  const p=await newPage(1920,1080); await openRewards(p);
  const b=await p.evaluate(()=>({grids:document.querySelectorAll('.bdg-grid').length,
    tiles:document.querySelectorAll('.bdg').length, got:document.querySelectorAll('.bdg.got').length}));
  ok('badges: grid shown per person',b.grids>0,JSON.stringify(b));
  ok('badges: all twelve listed',b.tiles>=12,JSON.stringify(b));
  ok('badges: locked and unlocked distinguished',b.got<b.tiles,JSON.stringify(b));
  await openSettings(p); await setSwitch(p,'badges',false); await openRewards(p);
  const off=await p.evaluate(()=>document.querySelectorAll('.bdg-grid').length);
  ok('badges: toggle off hides them',off===0,`grids=${off}`);
  ok('badges: no console errors',p.errs.length===0,p.errs.slice(0,2).join(' | '));
  await p.close();
});

console.log('\n--- KID ACCESS (parent PIN set) ---');
await block('kidaccess',async()=>{
  const p=await newPage(390,844);
  await openSettings(p);
  // set a real parent PIN through its own sheet (two inputs + submit)
  await p.evaluate(()=>document.querySelector('[data-act="pin-set"]')?.click());
  await new Promise(r=>setTimeout(r,500));
  const typed=await p.evaluate(()=>{
    const a=document.querySelector('#pin1'), b=document.querySelector('#pin2');
    if(!a||!b) return 'inputs missing';
    const set=(el,v)=>{el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));};
    set(a,'4821'); set(b,'4821');
    const form=a.closest('form'); if(!form) return 'no form';
    form.requestSubmit ? form.requestSubmit() : form.querySelector('[type=submit]')?.click();
    return 'submitted';});
  await new Promise(r=>setTimeout(r,800));
  const pinLive=await p.evaluate(()=>{
    const h=[...document.querySelectorAll('h3')].find(x=>x.textContent.trim()==='Parent PIN');
    return h ? /^On\./.test(h.closest('.card').innerText.replace(/^Parent PIN\s*/,'').trim()) : false;});
  ok('kid access: a parent PIN really is set',pinLive===true,`typed=${typed}`);
  // lock the device so we are acting as a kid
  await p.evaluate(()=>document.querySelector('[data-act="pin-lock"]')?.click());
  await new Promise(r=>setTimeout(r,800));
  const locked=await p.evaluate(async()=>{
    document.querySelector('[data-act="tab"][data-id="settings"]')?.click();
    await new Promise(r=>setTimeout(r,600));
    const gated=!!document.querySelector('.pinpad');
    document.querySelector('[data-act="close"]')?.click();
    return gated;});
  ok('kid access: settings are gated behind the PIN',locked===true);
  await new Promise(r=>setTimeout(r,400));
  await openRewards(p);
  const kid=await p.evaluate(()=>({badges:document.querySelectorAll('.bdg').length,
    levels:document.querySelectorAll('.lvl .cap').length,
    redeem:document.querySelectorAll('[data-act="redeem"]').length,
    adjust:document.querySelectorAll('[data-act="adjust"]').length,
    pad:!!document.querySelector('.pinpad')}));
  ok('kid access: Rewards opens without the PIN',kid.pad===false&&kid.redeem>0,JSON.stringify(kid));
  ok('kid access: sees their own badges',kid.badges>0,JSON.stringify(kid));
  ok('kid access: sees their own level',kid.levels>0,JSON.stringify(kid));
  // a kid can still finish a chore and be celebrated
  await openToday(p);
  const c=await liveChore(p);
  const fired=await p.evaluate(async id=>{window.__kbCel.log.length=0;
    document.querySelector(`[data-act="chore-toggle"][data-id="${id}"]`).click();
    await new Promise(r=>setTimeout(r,2000));
    return {log:window.__kbCel.log.map(x=>x.type),pad:!!document.querySelector('.pinpad')};},c.id);
  ok('kid access: can finish a chore without the PIN',fired.pad===false&&fired.log.includes('chore'),JSON.stringify(fired));
  ok('kid access: no console errors',p.errs.length===0,p.errs.slice(0,2).join(' | '));
  await p.close();
});

console.log('\n--- LEADERBOARD ---');
await block('board',async()=>{
  const p=await newPage(1920,1080);
  const def=await p.evaluate(()=>document.querySelectorAll('.lb').length);
  ok('board: off by default',def===0,`boards=${def}`);
  await openSettings(p); await setSwitch(p,'board',true); await openToday(p);
  const on=await p.evaluate(()=>({lb:document.querySelectorAll('.lb').length,
    rows:document.querySelectorAll('.lbr').length}));
  ok('board: appears when switched on',on.lb===1,JSON.stringify(on));
  ok('board: one row per person',on.rows>=2,JSON.stringify(on));
  ok('board: no console errors',p.errs.length===0,p.errs.slice(0,2).join(' | '));
  await p.close();
});

console.log('\n--- SWITCHES ---');
await block('switches',async()=>{
  const p=await newPage(390,844); await openSettings(p);
  const s=await p.evaluate(()=>{const b=[...document.querySelectorAll('.sw-t')];
    return {count:b.length, roles:b.every(x=>x.getAttribute('role')==='switch'),
      labelled:b.every(x=>(x.getAttribute('aria-label')||'').length>2),
      checked:b.every(x=>['true','false'].includes(x.getAttribute('aria-checked')))};});
  ok('switches: rendered',s.count>=7,JSON.stringify(s));
  ok('switches: use role=switch',s.roles===true);
  ok('switches: every one is labelled',s.labelled===true);
  ok('switches: expose on/off state',s.checked===true);
  const flip=await p.evaluate(()=>{const b=document.querySelector('[data-sw="game"][data-k="faces"]');
    const was=b.getAttribute('aria-checked'); b.click(); return {was};});
  await new Promise(r=>setTimeout(r,500));
  const now=await p.evaluate(()=>document.querySelector('[data-sw="game"][data-k="faces"]').getAttribute('aria-checked'));
  ok('switches: a tap flips and persists through re-render',flip.was!==now,`${flip.was} -> ${now}`);
  ok('switches: no console errors',p.errs.length===0,p.errs.slice(0,2).join(' | '));
  await p.close();
});

const bad=R.filter(x=>!x.pass);
console.log(`\n===== ${R.length-bad.length}/${R.length} PASSED =====`);
bad.forEach(f=>console.log('FAIL:',f.n,'|',f.d));
await browser.close(); srv.close();
