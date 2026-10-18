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

async function newPage(w,h,o={}){
  const p=await browser.newPage(); await p.setViewport({width:w,height:h});
  if(o.reducedMotion) await p.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  const errs=[]; p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
  p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message)); p.errs=errs;
  await p.goto(U,{waitUntil:'networkidle0'});
  await p.evaluate(()=>{try{localStorage.clear();sessionStorage.clear();}catch{}});
  await p.reload({waitUntil:'networkidle0'});
  // welcome gate -> use on this device only
  await p.evaluate(()=>{const b=document.querySelector('[data-act="fam-local"]');if(b)b.click();});
  await new Promise(r=>setTimeout(r,500));
  // load sample data (may live behind the Family tab)
  await p.evaluate(()=>{
    let b=document.querySelector('[data-act="sample-load"]');
    if(!b){ const t=[...document.querySelectorAll('[data-tab],[data-act="tab"]')].find(x=>/family/i.test(x.textContent||x.dataset.tab||'')); if(t)t.click(); }
  });
  await new Promise(r=>setTimeout(r,400));
  await p.evaluate(()=>{const b=document.querySelector('[data-act="sample-load"]');if(b)b.click();});
  await new Promise(r=>setTimeout(r,800));
  return p;
}
const choreCount=p=>p.evaluate(()=>document.querySelectorAll('[data-act="chore-toggle"]').length);

async function block(name,fn){ try{ await fn(); }catch(e){ ok(name+' (block crashed)',false,String(e).slice(0,200)); } }

console.log('\n--- VIEWPORTS ---');
for(const [label,w,h] of [['phone 390x844',390,844],['tablet 820x1180',820,1180],['wall 1920x1080',1920,1080]]){
  await block(label, async()=>{
    const p=await newPage(w,h);
    const people=await p.evaluate(()=>document.querySelectorAll('[data-person]').length);
    const chores=await choreCount(p);
    const ovf=await p.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
    ok(`${label}: no console errors`,p.errs.length===0,p.errs.slice(0,2).join(' | '));
    ok(`${label}: renders people`,people>0,`people=${people}`);
    ok(`${label}: has chores to tap`,chores>0,`chores=${chores}`);
    ok(`${label}: no horizontal overflow`,!ovf);
    await p.close();
  });
}

console.log('\n--- CHORE CELEBRATION ---');
await block('chore', async()=>{
  const p=await newPage(390,844);
  const S='[data-stars="sample-ava"]';            // Ava owns sample-c2, worth 2 stars
  const before=await p.evaluate(s=>document.querySelector(s)?.textContent.trim()??null,S);
  const r=await p.evaluate(async()=>{
    const b=document.querySelector('[data-act="chore-toggle"][data-id="sample-c2"]');
    if(!b)return{err:'sample-c2 not on screen'}; window.__kbCel.log.length=0; b.click();
    await new Promise(r=>setTimeout(r,2000));
    return{log:window.__kbCel.log.map(x=>({type:x.type,ms:x.end?Math.round(x.end-x.start):null,error:x.error,skipped:x.skipped}))};});
  const after=await p.evaluate(s=>document.querySelector(s)?.textContent.trim()??null,S);
  ok('chore: celebration fired',(r.log||[]).some(x=>x.type==='chore'),JSON.stringify(r));
  ok('chore: no internal error',!(r.log||[]).some(x=>x.error),JSON.stringify(r.log));
  ok('chore: star counter +2',before==='\u2605 0'&&after==='\u2605 2',`${before} -> ${after}`);
  ok('chore: duration under 2s',(r.log||[]).every(x=>!x.ms||x.ms<2000),JSON.stringify(r.log));
  ok('chore: no console errors',p.errs.length===0,p.errs.slice(0,2).join(' | '));
  await p.close();
});

console.log('\n--- QUEUEING (3 rapid) ---');
await block('queue', async()=>{
  const p=await newPage(1920,1080);
  const r=await p.evaluate(async()=>{window.__kbCel.log.length=0;
    const bs=[...document.querySelectorAll('[data-act="chore-toggle"]')].slice(0,3);
    bs.forEach(b=>b.click()); await new Promise(r=>setTimeout(r,10000));
    const L=window.__kbCel.log.filter(x=>x.end); let overlap=false;
    for(let i=1;i<L.length;i++) if(L[i].start<L[i-1].end-5) overlap=true;
    return{clicked:bs.length,played:L.length,overlap,seq:L.map(x=>({t:x.type,ms:Math.round(x.end-x.start)}))};});
  ok('queue: all 3 celebrated',r.played>=3,JSON.stringify(r));
  ok('queue: never two at once',r.overlap===false,JSON.stringify(r.seq));
  ok('queue: no console errors',p.errs.length===0,p.errs.slice(0,2).join(' | '));
  await p.close();
});

console.log('\n--- REDEEM OVERLAY ---');
await block('redeem', async()=>{
  const p=await newPage(390,844);
  await p.evaluate(()=>document.querySelector('[data-act="tab"][data-id="settings"]')?.click());
  await new Promise(r=>setTimeout(r,500));
  const r=await p.evaluate(async()=>{window.__kbCel.log.length=0;
    const b=[...document.querySelectorAll('[data-act="cel-preview"]')].find(x=>x.dataset.id==='redeem');
    if(!b)return{err:'no redeem preview button'}; b.click();
    await new Promise(r=>setTimeout(r,900));
    const ov=document.querySelector('[class*="cel"]');
    const o={present:!!ov}; if(ov){const cs=getComputedStyle(ov);o.bg=cs.backgroundColor;o.fg=cs.color;}
    await new Promise(r=>setTimeout(r,3500));
    return{...o,log:window.__kbCel.log.map(x=>({type:x.type,error:x.error})),
      leftover:!!document.querySelector('.cel-banner,.cel-overlay,.fx-canvas')};});
  ok('redeem: celebration fired',(r.log||[]).some(x=>x.type==='redeem'),JSON.stringify(r));
  ok('redeem: no internal error',!(r.log||[]).some(x=>x.error),JSON.stringify(r.log));
  ok('redeem: cleans up after itself',r.leftover===false,JSON.stringify({leftover:r.leftover}));
  ok('redeem: no console errors',p.errs.length===0,p.errs.slice(0,2).join(' | '));
  await p.close();
});

console.log('\n--- REDUCED MOTION ---');
await block('reduced', async()=>{
  const p=await newPage(390,844,{reducedMotion:true});
  const r=await p.evaluate(async()=>{window.__kbCel.log.length=0;
    const b=document.querySelector('[data-act="chore-toggle"]'); if(!b)return{err:'no chore-toggle'};
    b.click(); await new Promise(r=>setTimeout(r,1600));
    return{reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,
      log:window.__kbCel.log.map(x=>({type:x.type,error:x.error})),
      canvas:!!document.querySelector('.fx-canvas'),
      announced:(document.getElementById('announce')||{}).textContent||''};});
  ok('reduced-motion: query honoured',r.reduced===true);
  ok('reduced-motion: still celebrates',(r.log||[]).some(x=>x.type==='chore'),JSON.stringify(r));
  ok('reduced-motion: no confetti canvas',r.canvas===false);
  ok('reduced-motion: announced for screen readers',(r.announced||'').length>0,JSON.stringify(r.announced));
  ok('reduced-motion: no console errors',p.errs.length===0,p.errs.slice(0,2).join(' | '));
  await p.close();
});

console.log('\n--- CELEBRATIONS OFF ---');
await block('off', async()=>{
  const p=await newPage(390,844);
  const r=await p.evaluate(async()=>{localStorage.setItem('kb-cel-level','"off"'); window.__kbCel.log.length=0;
    const b=document.querySelector('[data-act="chore-toggle"]'); if(!b)return{err:'no chore-toggle'};
    b.click(); await new Promise(r=>setTimeout(r,1200));
    return{log:window.__kbCel.log,canvas:!!document.querySelector('.fx-canvas')};});
  ok('off: suppressed',(r.log||[]).some(x=>x.skipped==='off'),JSON.stringify(r));
  ok('off: no confetti',r.canvas===false);
  await p.close();
});

const bad=R.filter(x=>!x.pass);
console.log(`\n===== ${R.length-bad.length}/${R.length} PASSED =====`);
await browser.close(); srv.close();
