// Browser tests: the real app in headless Chromium against the real SQL (local Postgres via
// server.mjs). They click through the UI the way people do: sign up, create and launch a
// project, back it, comment, post updates, and see it funded.
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import pg from 'pg';
import { startMockStripe } from './mock-stripe.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const SHOTS = process.env.GS_SHOTS || '';
const PORT = Number(process.env.GS_PG_PORT || 54329);
Object.assign(process.env, {
  SUPABASE_URL: 'http://127.0.0.1:8098', SUPABASE_SERVICE_ROLE_KEY: 'service-test-key', GS_SERVICE_KEY: 'service-test-key',
  STRIPE_SECRET_KEY: 'sk_test_mock', STRIPE_API_BASE: 'http://127.0.0.1:8099', STRIPE_WEBHOOK_SECRET: 'whsec_test',
  RESEND_API_KEY: 're_test', RESEND_API_BASE: 'http://127.0.0.1:8099', GS_APP_URL: 'http://127.0.0.1:8098/',
});
execFileSync(path.join(HERE, 'reset-db.sh'), [String(PORT)], { stdio: 'inherit' });
const su = new pg.Pool({ host: '127.0.0.1', port: PORT, user: 'postgres', database: 'gs_test', max: 2 });
const sql = async (q, a = []) => (await su.query(q, a)).rows;
await sql(`insert into vault.decrypted_secrets values ('gs_worker_secret', 'test-worker-secret')`);
const { startServer } = await import('./server.mjs');
const { handle } = await import('../supabase/functions/gs/index.ts');
const stripeMock = await startMockStripe(8099);
const srv = await startServer(8098, { fn: handle });
const runWorker = async () => (await fetch(srv.origin + '/functions/v1/gs/worker', { method: 'POST', headers: { 'x-worker-secret': 'test-worker-secret' } })).json();
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


await block('email: add, confirm, reset by email', async () => {
  const p = await newPage(1280, 800);
  await login(p, 'maya');
  await nav(p, '#/settings');
  await p.waitForSelector('form[data-form=email-set]');
  await p.fill('form[data-form=email-set] input[name=email]', 'maya@example.com');
  await p.click('form[data-form=email-set] button[type=submit]');
  await p.waitForSelector('form[data-form=email-verify]');
  const code = (await sql(`select data->>'code' c from outbox where to_email = 'maya@example.com' and template = 'verify' order by id desc limit 1`))[0].c;
  await p.fill('form[data-form=email-verify] input[name=code]', '000000' === code ? '111111' : '000000');
  await p.click('form[data-form=email-verify] button[type=submit]');
  await p.waitForSelector('form[data-form=email-verify] .err');
  ok('a wrong code shows an error', /isn.t right/.test(await text(p, 'form[data-form=email-verify] .err')));
  await p.fill('form[data-form=email-verify] input[name=code]', code);
  await p.click('form[data-form=email-verify] button[type=submit]');
  await p.waitForSelector('[data-setting=email_notify]');
  ok('email confirmed in settings', /maya@example.com/.test(await text(p, '#email')));
  await p.uncheck('[data-setting=email_notify]');
  await p.waitForTimeout(400);
  ok('email notifications can be switched off', (await sql(`select email_notify from users where username = 'maya'`))[0].email_notify === false);
  await p.check('[data-setting=email_notify]');
  await p.waitForTimeout(400);
  await p.evaluate(() => localStorage.clear());
  await p.goto(U); await nav(p, '#/forgot');
  await p.fill('form[data-form=forgot] input[name=username]', 'maya');
  await p.click('[data-act=reset-email]');
  await p.waitForSelector('.toast');
  await runWorker();
  const mail = stripeMock.state.emails.find(m => m.to[0] === 'maya@example.com' && /Reset/.test(m.subject));
  const rc = mail && mail.text.match(/\n([A-Z0-9]{8})\n/);
  ok('reset code arrives by email', !!rc);
  await p.fill('form[data-form=forgot] input[name=code]', rc[1]);
  await p.fill('form[data-form=forgot] input[name=password]', 'password123');
  await p.click('form[data-form=forgot] button[type=submit]');
  await p.waitForFunction(() => !!(window.__gs && window.__gs.S.token));
  ok('reset by email logs in without a recovery-code prompt', await p.locator('.modal .code').count() === 0);
  ok('email flow had no console errors', p.errs.length === 0, p.errs.join(' | '));
  await p.context().close();
});

let rslug;
await block('real payments: switch on, payouts, pledge with a card', async () => {
  await sql(`update users set is_admin = true where username = 'maya'`);
  await runWorker();
  const a = await newPage(1280, 800);
  await login(a, 'maya');
  await nav(a, '#/admin');
  await a.waitForSelector('[data-act=adm-pay][data-mode=stripe]');
  await a.click('[data-act=adm-pay][data-mode=stripe]');
  await a.click('.modal [data-yes]');
  await a.waitForFunction(() => window.__gs.conf().payments === 'stripe');
  ok('admin switches on real payments', (await a.innerText('#foot')).indexOf('Test mode') === -1);
  await nav(a, '#/settings');
  await a.waitForSelector('[data-act=stripe-connect]');
  await shot(a, 'settings-payouts-desktop');
  await a.click('[data-act=stripe-connect]');
  await a.waitForURL(/127\.0\.0\.1:8099\/connect\//);
  await a.click('#finish');
  await a.waitForURL(/#\/settings/);
  await a.waitForSelector('[data-act=stripe-dashboard]');
  ok('creator connects Stripe and comes back ready', /Stripe is connected/.test(await text(a, '#payouts')));
  const r = await a.evaluate(async () => {
    const call = async (n, x) => (await fetch(`/rest/v1/rpc/${n}`, { method: 'POST', headers: { apikey: 'x', 'Content-Type': 'application/json' }, body: JSON.stringify({ p_token: window.__gs.S.token, ...x }) })).json();
    let e = await call('gs_project_new', { p_title: 'Real money radio', p_category: 'technology', p_currency: 'CAD' });
    e = await call('gs_project_save', { p_project: e.id, p_patch: { blurb: 'A pocket radio funded for real.', story: 'y'.repeat(200), risks: 'Radio parts can be scarce; we have two suppliers.', goal_cents: 10000 } });
    e = await call('gs_reward_save', { p_project: e.id, p_reward: { title: 'Radio', amount: 6000, ships: true, shipping: 1000 } });
    return call('gs_project_launch', { p_project: e.id });
  });
  rslug = r.slug;
  ok('project launches with real payments', r.payments === 'stripe', JSON.stringify(r).slice(0, 200));
  await a.context().close();

  const b = await newPage(390, 844);
  await login(b, 'sam');
  await nav(b, `#/p/${rslug}/pledge?reward=${r.rewards[0].id}`);
  await b.waitForSelector('[data-act=pl-next]');
  await b.click('[data-act=pl-next]');
  await b.waitForSelector('form[data-form=pledge]');
  ok('review explains Stripe instead of test mode', /Secure payment by Stripe/.test(await b.innerText('main')) && /Continue to payment/.test(await text(b, 'form[data-form=pledge] button[type=submit]')));
  await shot(b, 'pledge-review-stripe-phone');
  await b.check('form[data-form=pledge] input[name=ok]');
  await b.click('form[data-form=pledge] button[type=submit]');
  await b.waitForURL(/127\.0\.0\.1:8099\/checkout\//);
  ok('backer is sent to Stripe Checkout', /charged CA\$70 only if Real money radio reaches its goal/.test(await b.innerText('body')));
  await b.click('#save-card');
  await b.waitForSelector('.thanks h1 >> text=backer');
  ok('back in the app as backer #1', /backer #1/.test(await text(b, '.thanks h1')) && /Visa ending in 4242/.test(await b.innerText('.thanks')), await b.innerText('.thanks'));
  await nav(b, '#/p/' + rslug);
  await b.waitForSelector('#pstats .mine');
  ok('project page shows the saved card', /Visa ending in 4242/.test(await text(b, '#pstats .mine')));
  ok('stripe pledge flow had no console errors', b.errs.length === 0, b.errs.join(' | '));
  await b.context().close();

  // A second backer whose card will be declined.
  const c = await newPage(1280, 800);
  await signup(c, 'tess', 'Tess Decline');
  await nav(c, `#/p/${rslug}/pledge?reward=none`);
  await c.waitForSelector('[data-pl]');
  await c.fill('[data-pl]', '40');
  await c.click('[data-act=pl-next]');
  await c.check('form[data-form=pledge] input[name=ok]');
  await c.click('form[data-form=pledge] button[type=submit]');
  await c.waitForURL(/checkout/);
  await c.click('#save-declining');
  await c.waitForSelector('.thanks h1 >> text=backer');
  ok('second backer pledged with a card that will fail', /backer #2/.test(await text(c, '.thanks h1')));
  await c.context().close();
});

await block('real payments: charging, a declined card, and the fix', async () => {
  await sql(`update projects set deadline = now() - interval '1 minute' where slug = $1`, [rslug]);
  const w = await runWorker();
  ok('worker charges the good card and flags the declined one', w.charges === 1 && w.charge_failures === 1, JSON.stringify(w));
  const b = await newPage(1280, 800);
  await login(b, 'sam');
  await nav(b, '#/p/' + rslug);
  await b.waitForSelector('#pstats .mine');
  ok('backer sees the charge', /Charged to your Visa ending in 4242/.test(await b.innerText('#pstats')));
  await b.context().close();
  const c = await newPage(390, 844);
  await login(c, 'tess');
  await nav(c, '#/p/' + rslug);
  await c.waitForSelector('[data-act=fix-card]');
  ok('declined backer is asked to update the card', /payment didn.t go through/.test(await c.innerText('#pstats')));
  await shot(c, 'payment-failed-phone');
  await c.click('[data-act=fix-card]');
  await c.waitForURL(/checkout/);
  await c.click('#save-card');
  await c.waitForURL(/#\/p\//);
  await c.waitForSelector('.toast');
  ok('new card saved', /Card saved/.test(await c.innerText('.toasts')));
  const w2 = await runWorker();
  ok('charge retried and paid', w2.charges === 1, JSON.stringify(w2));
  await nav(c, '#/activity');
  await c.waitForSelector('.note');
  ok('activity shows the failure and the receipt', /didn.t go through/.test(await c.innerText('main')) && /was charged/.test(await c.innerText('main')));
  ok('fix flow had no console errors', c.errs.length === 0, c.errs.join(' | '));
  await c.context().close();
});

await block('shipping survey', async () => {
  const a = await newPage(1280, 800);
  await login(a, 'maya');
  const pid = (await sql(`select id from projects where slug = $1`, [rslug]))[0].id;
  await nav(a, '#/dash/' + pid);
  await a.waitForSelector('[data-act=survey-send]');
  ok('dashboard shows what was collected and the fee', /Paid out to your Stripe account/.test(await a.innerText('main')) && /CA\$110/.test(await a.innerText('main')));
  await shot(a, 'dashboard-after-success-desktop');
  await a.click('[data-act=survey-send]');
  await a.click('.modal [data-yes]');
  await a.waitForSelector('.toast >> text=Survey sent');
  ok('survey sent to the one shipping backer', /Survey sent to 1 backer/.test(await a.innerText('.toasts')), await a.innerText('.toasts'));
  const b = await newPage(390, 844);
  await login(b, 'sam');
  await nav(b, '#/p/' + rslug);
  await b.waitForSelector('[data-act=address]');
  await b.click('[data-act=address]');
  await b.fill('form[data-form=address] input[name=name]', 'Sam Lee');
  await b.fill('form[data-form=address] input[name=line1]', '12 Harbour Rd');
  await b.fill('form[data-form=address] input[name=city]', 'Halifax');
  await b.fill('form[data-form=address] input[name=country]', 'Canada');
  await shot(b, 'address-form-phone');
  await b.click('form[data-form=address] button[type=submit]');
  await b.waitForSelector('#pstats .mine >> text=Shipping to');
  ok('backer sees where it ships', /12 Harbour Rd/.test(await b.innerText('#pstats')));
  await b.context().close();
  await nav(a, '#/dash/' + pid + '?tab=backers');
  await a.waitForSelector('table');
  ok('creator sees the address in the backer list', /12 Harbour Rd/.test(await a.innerText('table')));
  ok('creator flow had no console errors', a.errs.length === 0, a.errs.join(' | '));
  await a.context().close();
});

await block('layout at phone, tablet and desktop, light and dark', async () => {
  for (const [label, w, h, dark] of [['phone', 390, 844, false], ['tablet', 820, 1180, false], ['desktop', 1440, 900, false], ['phone-dark', 390, 844, true], ['desktop-dark', 1440, 900, true]]) {
    const p = await newPage(w, h, { dark });
    await login(p, 'maya');
    const pages = ['#/', '#/explore', '#/p/' + slug, `#/p/${slug}/updates`, `#/edit/${projectId}/basics`, `#/edit/${projectId}/story`, `#/edit/${projectId}/launch`, `#/dash/${projectId}`, '#/activity', '#/me/created', '#/me', '#/u/maya', '#/settings', '#/how', '#/start', '#/admin', '#/p/' + rslug];
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

await browser.close(); await srv.close(); await stripeMock.close(); await su.end();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
