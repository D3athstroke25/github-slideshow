// Browser tests: the real app in headless Chromium against the real SQL (local Postgres via
// server.mjs). They click through the UI the way people do: sign up, create and launch a
// project, back it, comment, post updates, and see it funded.
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import pg from 'pg';
import { startServer } from './server.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const SHOTS = process.env.GS_SHOTS || '';
const PORT = Number(process.env.GS_PG_PORT || 54329);
execFileSync(path.join(HERE, 'reset-db.sh'), [String(PORT)], { stdio: 'inherit' });
const su = new pg.Pool({ host: '127.0.0.1', port: PORT, user: 'postgres', database: 'gs_test', max: 2 });
const sql = async (q, a = []) => (await su.query(q, a)).rows;
const srv = await startServer(8098);
const U = srv.origin + '/';
const browser = await chromium.launch();

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (detail ? '  >> ' + String(detail).slice(0, 300) : '')); }
};
async function block(name, f) {
  console.log('\n--- ' + name + ' ---');
  try { await f(); } catch (e) { ok(name + ' (crashed)', false, e.stack.split('\n').slice(0, 4).join(' | ')); }
}
async function newPage(w, h, { dark = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: dark ? 'dark' : 'light', deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.errs = [];
  p.on('console', m => { if (m.type() === 'error') p.errs.push(m.text()); });
  p.on('pageerror', e => p.errs.push('PAGEERROR ' + e.message));
  p.on('dialog', d => { p.errs.push('DIALOG ' + d.message()); d.dismiss(); });
  await p.goto(U);
  return p;
}
const nav = async (p, hash) => { await p.evaluate(h => { location.hash = h; }, hash); await p.waitForTimeout(350); };
const overflow = p => p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true }); };
const text = (p, sel) => p.locator(sel).first().innerText();

async function signup(p, username, name, password = 'password123') {
  await nav(p, '#/signup');
  await p.fill('form[data-form=signup] input[name=name]', name);
  await p.fill('form[data-form=signup] input[name=username]', username);
  await p.fill('form[data-form=signup] input[name=password]', password);
  await p.click('form[data-form=signup] button[type=submit]');
  await p.waitForSelector('.modal .code');
  const code = await text(p, '.modal .code');
  await p.check('#saved-ok');
  await p.click('#rc-done');
  await p.waitForTimeout(300);
  return code;
}
async function login(p, username, password = 'password123') {
  await nav(p, '#/login');
  await p.fill('form[data-form=login] input[name=username]', username);
  await p.fill('form[data-form=login] input[name=password]', password);
  await p.click('form[data-form=login] button[type=submit]');
  await p.waitForFunction(() => !!(window.__gs && window.__gs.S.token));
  await p.waitForTimeout(300);
}
async function logout(p) {
  await p.evaluate(() => { localStorage.clear(); });
  await p.goto(U); await p.waitForTimeout(300);
}

const STORY = `## What we're making

**Tidepool** is a modular desk lamp. Snap on arms as you need them, and _dim_ it smoothly.

- Machined aluminium
- Warm 2700K light

> Light that grows with your desk.

<script>window.__xss = 1</script>
<img src=x onerror="window.__xss = 2">
[click me](javascript:window.__xss=3)
[our site](https://example.com)`;

let slug, projectId, rewardTitle = 'Early bird lamp';

await block('empty home and layout', async () => {
  const p = await newPage(1440, 900);
  await p.waitForSelector('.hero h1');
  ok('home renders with no projects', /No projects are live yet/.test(await p.innerText('main')));
  ok('no console errors on first load', p.errs.length === 0, p.errs.join(' | '));
  ok('test mode is shown in the footer', /Test mode/.test(await p.innerText('#foot')));
  await p.context().close();
});

await block('creator: sign up, draft, launch', async () => {
  const p = await newPage(1440, 900);
  const code = await signup(p, 'maya', 'Maya Okafor');
  ok('signup shows a recovery code', /^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/.test(code), code);
  ok('header shows the account menu', await p.locator('[data-act=menu]').count() === 1);

  await nav(p, '#/start');
  await p.click('[data-act=pick-cat][data-cat=design]');
  await p.fill('form[data-form=start] input[name=title]', 'Tidepool: a modular desk lamp');
  await p.selectOption('form[data-form=start] select[name=currency]', 'CAD');
  await p.click('form[data-form=start] button[type=submit]');
  await p.waitForSelector('[data-field=blurb]');
  ok('draft opens in the editor', /\/edit\/[0-9a-f-]+\/basics$/.test(await p.evaluate(() => location.hash)));
  projectId = (await p.evaluate(() => location.hash)).split('/')[2];

  await p.fill('[data-field=blurb]', 'A desk lamp you can extend, arm by arm, as your work grows.');
  await p.fill('[data-field=location]', 'Halifax, NS');
  await p.fill('[data-field=goal]', '500');
  await p.locator('[data-field=goal]').blur();
  await p.evaluate(() => { const r = document.querySelector('[data-field=duration]'); r.value = '21'; r.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.setInputFiles('[data-upload=cover]', path.join(HERE, '../web/icons/icon-512.png'));
  await p.waitForSelector('#drop img', { timeout: 10000 });
  ok('editor keeps unsaved edits when it re-renders', (await text(p, '[data-count=duration]')) === '21' && (await p.inputValue('[data-field=goal]')) === '500');
  await p.waitForFunction(() => /Saved/.test(document.querySelector('#savestate').textContent), null, { timeout: 8000 });
  const saved = await sql(`select blurb, goal_cents, duration_days, cover_path, location, currency from projects where id = $1`, [projectId]);
  ok('basics autosave to the database', saved[0].goal_cents === '50000' && saved[0].duration_days === 21 && saved[0].location === 'Halifax, NS' && saved[0].currency === 'CAD', JSON.stringify(saved[0]));
  ok('cover uploaded through the storage policy', saved[0].cover_path && srv.files.has(saved[0].cover_path), saved[0].cover_path);
  const img = srv.files.get(saved[0].cover_path);
  ok('cover was re-encoded as JPEG on the device', img && img.type === 'image/jpeg' && img.data[0] === 0xFF && img.data[1] === 0xD8);
  await shot(p, 'editor-basics-desktop');

  await nav(p, `#/edit/${projectId}/rewards`);
  await p.click('[data-act=reward-edit]');
  await p.fill('form[data-form=reward] input[name=title]', rewardTitle);
  await p.fill('form[data-form=reward] input[name=amount]', '120');
  await p.fill('form[data-form=reward] textarea[name=description]', 'One Tidepool lamp with two arms.');
  await p.fill('[data-item-input]', 'Tidepool lamp'); await p.press('[data-item-input]', 'Enter');
  await p.fill('[data-item-input]', 'Two arms'); await p.press('[data-item-input]', 'Enter');
  await p.fill('form[data-form=reward] input[name=est_delivery]', '2027-05');
  await p.check('form[data-form=reward] input[name=ships][value=yes]');
  await p.fill('form[data-form=reward] input[name=shipping]', '15');
  await p.check('form[data-form=reward] input[name=limited]');
  await p.fill('form[data-form=reward] input[name=limit]', '50');
  await shot(p, 'reward-modal-desktop');
  await p.click('form[data-form=reward] button[type=submit]');
  await p.waitForSelector('.r-row');
  const rw = await sql(`select title, amount_cents, shipping_cents, ships, limit_qty, items, est_delivery from rewards where project_id = $1`, [projectId]);
  ok('reward saved with items, shipping and limit', rw.length === 1 && rw[0].amount_cents === '12000' && rw[0].shipping_cents === '1500' && rw[0].limit_qty === 50 && rw[0].items.length === 2, JSON.stringify(rw[0]));
  await p.click('[data-act=reward-edit]:not([data-id])');
  await p.fill('form[data-form=reward] input[name=title]', 'Thank-you postcard');
  await p.fill('form[data-form=reward] input[name=amount]', '10');
  await p.click('form[data-form=reward] button[type=submit]');
  await p.waitForFunction(() => document.querySelectorAll('.r-row').length === 2);

  await nav(p, `#/edit/${projectId}/story`);
  await p.fill('[data-field=story]', STORY);
  await p.fill('[data-field=risks]', 'Our aluminium supplier could slip by a few weeks; we have a backup quote ready.');
  await p.locator('[data-field=risks]').blur();
  await p.click('[data-act=md-mode]');
  ok('story preview renders markdown', await p.locator('.mdwrap .preview h3').count() === 1 && await p.locator('.mdwrap .preview script').count() === 0);
  await nav(p, `#/edit/${projectId}/faq`);
  await p.click('[data-act=faq-add]');
  await p.fill('[data-faq-q]', 'Does it dim?');
  await p.fill('[data-faq-a]', 'Yes, smoothly from 5% to 100%.');
  await p.locator('[data-faq-a]').blur();
  await p.waitForTimeout(1200);

  await nav(p, `#/edit/${projectId}/launch`);
  await p.waitForSelector('.checklist');
  const ticks = await p.locator('.checklist a.ok').count();
  ok('launch checklist is complete', ticks === 6, `ticks=${ticks}`);
  ok('all editor steps are ticked', await p.locator('.steps .tick.ok').count() === 4);
  await shot(p, 'editor-launch-desktop');
  await p.click('[data-act=launch]');
  await p.click('.modal [data-yes]');
  await p.waitForSelector('.p-head h1');
  slug = (await p.evaluate(() => location.hash)).split('/')[2];
  ok('lands on the live project page', slug === 'tidepool-a-modular-desk-lamp', slug);
  ok('creator sees edit and dashboard', await p.locator('#pstats a[href^="#/edit/"]').count() === 1 && await p.locator('#pstats a[href^="#/dash/"]').count() === 1);
  ok('story is rendered as formatted text', await p.locator('.prose h3').count() >= 1 && await p.locator('.prose blockquote').count() === 1);
  ok('script tags in the story are not run', await p.evaluate(() => window.__xss) === undefined && await p.locator('.prose script').count() === 0);
  ok('javascript: links are not rendered', await p.locator('.prose a[href^="javascript"]').count() === 0 && await p.locator('.prose a[href="https://example.com"]').count() === 1);
  ok('creator flow had no console errors', p.errs.length === 0, p.errs.join(' | '));
  await shot(p, 'project-creator-desktop');
  await p.context().close();
});

await block('backer: pledge, comment, save', async () => {
  const p = await newPage(390, 844);
  await signup(p, 'sam', 'Sam Lee');
  await nav(p, '#/p/' + slug);
  await p.waitForSelector('.mobile-cta a');
  ok('phone shows a sticky Back this project bar', /Back this project/.test(await text(p, '.mobile-cta')));
  await p.click('.mobile-cta a');
  await p.waitForSelector('[data-act=pl-pick]');
  await shot(p, 'pledge-pick-phone');
  await p.locator('[data-act=pl-pick]', { hasText: rewardTitle }).click();
  await p.fill('[data-pl]', '10');
  ok('total includes reward, shipping and bonus', /145/.test(await text(p, '#pl-total')), await text(p, '#pl-total'));
  await p.click('[data-act=pl-next]');
  await p.waitForSelector('form[data-form=pledge]');
  ok('review shows the test-mode notice', /Test mode/.test(await p.innerText('main')));
  await shot(p, 'pledge-review-phone');
  await p.check('form[data-form=pledge] input[name=ok]');
  await p.click('form[data-form=pledge] button[type=submit]');
  await p.waitForSelector('.thanks h1');
  ok('thank-you page shows backer number', /backer #1/.test(await text(p, '.thanks h1')), await text(p, '.thanks h1'));
  await shot(p, 'thanks-phone');
  const pl = await sql(`select amount_cents, shipping_cents, status from pledges`);
  ok('pledge stored: 120 + 15 shipping + 10 bonus', pl.length === 1 && pl[0].amount_cents === '14500' && pl[0].shipping_cents === '1500' && pl[0].status === 'active', JSON.stringify(pl));

  await nav(p, '#/p/' + slug);
  await p.waitForSelector('#pstats .mine');
  ok('project page shows my pledge', /backer #1/.test(await text(p, '#pstats .mine')));
  await p.click('#pstats [data-act=save]');
  await p.waitForFunction(() => document.querySelector('#pstats [data-act=save]').getAttribute('aria-pressed') === 'true');
  ok('remind me saves the project', (await sql(`select count(*)::int n from saves`))[0].n === 1);

  await nav(p, `#/p/${slug}/comments`);
  await p.waitForSelector('form[data-form=comment] textarea');
  await p.fill('form[data-form=comment] textarea', 'Can\'t wait for mine! <b>bold?</b>');
  await p.click('form[data-form=comment] button[type=submit]');
  await p.waitForSelector('.comment .text');
  ok('comment posted and shown escaped', (await text(p, '.comment .text')).includes('<b>bold?</b>'));
  ok('backer badge on comment', /Backer/.test(await text(p, '.comment .who')));

  await nav(p, '#/me');
  await p.waitForSelector('.cards');
  ok('my backed list shows the pledge', /145/.test(await p.innerText('main')));
  ok('backer flow had no console errors', p.errs.length === 0, p.errs.join(' | '));
  ok('phone pages have no horizontal overflow', !(await overflow(p)));
  await p.context().close();
});

await block('pledge changes and limits', async () => {
  const p = await newPage(1280, 800);
  await login(p, 'sam');
  await nav(p, `#/p/${slug}/pledge`);
  await p.waitForSelector('[data-act=pl-pick].sel');
  ok('manage pledge preselects my reward and bonus', /Early bird/.test(await text(p, '.reward.sel')) && (await p.inputValue('[data-pl]')) === '10');
  await p.fill('[data-pl]', '0');
  await p.click('[data-act=pl-next]');
  await p.check('form[data-form=pledge] input[name=ok]');
  await p.click('form[data-form=pledge] button[type=submit]');
  await p.waitForSelector('.p-head h1');
  ok('lowering the pledge updates it in place', (await sql(`select amount_cents, backer_no from pledges`))[0].amount_cents === '13500');
  await nav(p, `#/p/${slug}/pledge`);
  await p.waitForSelector('[data-act=pl-pick]');
  await p.locator('[data-act=pl-pick]', { hasText: 'Pledge without a reward' }).click();
  await p.fill('[data-pl]', '0.5');
  await p.click('[data-act=pl-next]');
  ok('below-minimum pledge is refused in the app', await p.locator('.toast.bad').count() === 1 && await p.locator('form[data-form=pledge]').count() === 0);
  await p.context().close();
});

await block('creator: activity, dashboard, updates', async () => {
  const p = await newPage(1440, 900);
  await login(p, 'maya');
  await p.waitForSelector('.top .dot-badge');
  ok('unread badge after a backer pledged and commented', +(await text(p, '.top .dot-badge')) >= 2);
  await nav(p, '#/activity');
  await p.waitForSelector('.note');
  const act = await p.innerText('main');
  ok('activity lists first backer and comment', /first backer/.test(act) && /commented on/.test(act), act.slice(0, 200));
  await p.waitForTimeout(500);
  ok('opening activity clears the badge', await p.locator('.top .dot-badge').count() === 0);

  await nav(p, `#/dash/${projectId}`);
  await p.waitForSelector('#chart svg');
  ok('dashboard shows pledged total', /135/.test(await p.innerText('.kpis')), await p.innerText('.kpis'));
  ok('funding chart has a line and goal', await p.locator('#chart .line').count() === 1 && await p.locator('#chart .goal').count() === 1);
  await p.hover('#hit');
  ok('chart hover shows a tooltip', await p.locator('#tip:not([hidden])').count() === 1);
  await shot(p, 'dashboard-desktop');
  await p.click('[data-act=dash-tab][data-tab=backers]');
  ok('backers table lists Sam', /Sam Lee/.test(await p.innerText('table')));
  await p.click('[data-act=dash-tab][data-tab=updates]');
  await p.fill('form[data-form=update] input[name=title]', 'First prototypes are in');
  await p.fill('form[data-form=update] textarea', 'Here is what the **second arm** looks like.');
  await p.check('form[data-form=update] input[name=backers_only]');
  await p.click('form[data-form=update] button[type=submit]');
  await p.waitForSelector('.r-row .tag');
  ok('update posted', (await sql(`select count(*)::int n from updates where backers_only`))[0].n === 1);
  ok('creator flow had no console errors', p.errs.length === 0, p.errs.join(' | '));
  await p.context().close();
});

await block('backers-only update visibility', async () => {
  const p = await newPage(1280, 800);
  await nav(p, `#/p/${slug}/updates/1`);
  await p.waitForSelector('.p-body article');
  ok('signed-out visitors see a locked update', /For backers only/.test(await p.innerText('.p-body article')) && !/second arm/.test(await p.innerText('main')));
  ok('signed-out visitors cannot comment', await p.locator('form[data-form=comment]').count() === 0);
  await login(p, 'sam');
  await nav(p, '#/activity');
  await p.waitForSelector('.note');
  ok('backer notified of the update', /posted Update #1/.test(await p.innerText('main')));
  await p.click('.note >> nth=0');
  await p.waitForSelector('.p-body article .prose strong');
  ok('backer can read the update', /second arm/.test(await p.innerText('.p-body article')));
  await p.context().close();
});

await block('discovery', async () => {
  const p = await newPage(1440, 900);
  await p.waitForSelector('.feature h3');
  ok('home features the live project', /Tidepool/.test(await text(p, '.feature h3')));
  await shot(p, 'home-desktop');
  await p.fill('.top-search input', 'halifax');
  await p.press('.top-search input', 'Enter');
  await p.waitForSelector('#grid .card');
  ok('header search finds by location', await p.locator('#grid .card').count() === 1);
  await nav(p, '#/explore?cat=music');
  await p.waitForSelector('#results .empty');
  ok('category with no projects shows an empty state', true);
  await nav(p, '#/explore');
  await p.waitForSelector('#grid .card');
  await p.selectOption('.filters select[name=sort]', 'ending');
  await p.waitForFunction(() => location.hash.includes('sort=ending'));
  ok('sort select applies immediately', true);
  ok('discovery had no console errors', p.errs.length === 0, p.errs.join(' | '));
  await p.context().close();
});

await block('all-or-nothing result', async () => {
  await sql(`update projects set deadline = now() - interval '1 minute' where slug = $1`, [slug]);
  const p = await newPage(1280, 800);
  await nav(p, '#/p/' + slug);
  await p.waitForSelector('#pstats .result');
  ok('ended project below goal shows unsuccessful', /Funding unsuccessful/.test(await text(p, '#pstats .result')));
  await login(p, 'sam');
  await nav(p, '#/p/' + slug);
  await p.waitForSelector('#pstats .mine');
  ok('backer told their pledge was not collected', /not collected/.test(await text(p, '#pstats .mine')));
  await p.context().close();

  // A second project that does reach its goal.
  const c = await newPage(1280, 800);
  await login(c, 'maya');
  const r = await c.evaluate(async () => {
    const call = async (n, a) => (await fetch(`/rest/v1/rpc/${n}`, { method: 'POST', headers: { apikey: 'x', 'Content-Type': 'application/json' }, body: JSON.stringify({ p_token: window.__gs.S.token, ...a }) })).json();
    let e = await call('gs_project_new', { p_title: 'Quiet Hours album', p_category: 'music' });
    e = await call('gs_project_save', { p_project: e.id, p_patch: { blurb: 'A lo-fi album recorded in a lighthouse.', story: 'x'.repeat(200), risks: 'Weather may delay the recording sessions by a week.', goal_cents: 1000 } });
    e = await call('gs_reward_save', { p_project: e.id, p_reward: { title: 'Digital album', amount: 1000 } });
    e = await call('gs_project_launch', { p_project: e.id });
    return e;
  });
  await c.context().close();
  const b = await newPage(1280, 800);
  await login(b, 'sam');
  await nav(b, `#/p/${r.slug}/pledge?reward=${r.rewards[0].id}`);
  await b.waitForSelector('[data-act=pl-next]');
  await b.click('[data-act=pl-next]');
  await b.check('form[data-form=pledge] input[name=ok]');
  await b.click('form[data-form=pledge] button[type=submit]');
  await b.waitForSelector('.thanks h1');
  await sql(`update projects set deadline = now() - interval '1 minute' where slug = $1`, [r.slug]);
  await nav(b, '#/p/' + r.slug);
  await b.waitForSelector('#pstats .result.good');
  ok('funded project shows success and collected pledge', /Funded/.test(await text(b, '#pstats .result')) && /collected/.test(await text(b, '#pstats .mine')));
  await nav(b, '#/activity');
  await b.waitForSelector('.note');
  ok('backer notified it was funded', /successfully funded/.test(await b.innerText('main')));
  await b.context().close();
});

await block('layout at phone, tablet and desktop, light and dark', async () => {
  for (const [label, w, h, dark] of [['phone', 390, 844, false], ['tablet', 820, 1180, false], ['desktop', 1440, 900, false], ['phone-dark', 390, 844, true], ['desktop-dark', 1440, 900, true]]) {
    const p = await newPage(w, h, { dark });
    await login(p, 'maya');
    const pages = ['#/', '#/explore', '#/p/' + slug, `#/p/${slug}/updates`, `#/edit/${projectId}/basics`, `#/edit/${projectId}/story`, `#/dash/${projectId}`, '#/activity', '#/me/created', '#/u/maya', '#/settings', '#/how', '#/start'];
    const bad = [];
    for (const hsh of pages) {
      await nav(p, hsh); await p.waitForTimeout(250);
      if (await overflow(p)) bad.push(hsh);
    }
    ok(`${label}: no horizontal overflow`, bad.length === 0, bad.join(', '));
    ok(`${label}: no console errors`, p.errs.length === 0, p.errs.slice(0, 3).join(' | '));
    if (label === 'phone' || label === 'desktop-dark' || label === 'phone-dark') {
      await nav(p, '#/'); await shot(p, `home-${label}`);
      await nav(p, '#/p/' + slug); await shot(p, `project-${label}`);
      await nav(p, `#/dash/${projectId}`); await shot(p, `dashboard-${label}`);
    }
    await p.context().close();
  }
  const s = await newPage(390, 844);
  await nav(s, '#/signup'); await shot(s, 'signup-phone');
  await s.context().close();
});

await browser.close(); await srv.close(); await su.end();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
