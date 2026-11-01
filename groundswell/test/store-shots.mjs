// App Store screenshots: the real app against the local test database, loaded with the sample
// projects and shown as a live site with real payments on. Writes iPhone 6.9" (1320x2868) and
// iPad 13" (2064x2752) PNGs to native/screenshots/. Needs the same local Postgres as the tests.
// Usage: npm run shots
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import pg from 'pg';

const GS = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(GS, 'native/screenshots');
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = Number(process.env.GS_PG_PORT || 54329);
const psql = (...a) => execFileSync('psql', ['-h', '127.0.0.1', '-p', String(PORT), '-U', 'postgres', '-d', 'gs_test', '-v', 'ON_ERROR_STOP=1', '-q', ...a], { stdio: 'inherit' });

execFileSync(path.join(GS, 'test/reset-db.sh'), [String(PORT)], { stdio: 'ignore' });
psql('-f', path.join(GS, 'supabase/seed/samples.sql'));
const su = new pg.Pool({ host: '127.0.0.1', port: PORT, user: 'postgres', database: 'gs_test', max: 2 });
const sql = async (q, a = []) => (await su.query(q, a)).rows;

// Present the samples as real projects on a site with real payments switched on.
await sql(`update projects set sample = false, payments = 'stripe'`);
await sql(`update users set sample = false, bio = '' where bio like 'Sample creator account%'`);
await sql(`update users set bio = 'Two friends in Montreal making cooperative games for families and game nights.' where username = 'sample_lantern'`);
await sql(`update settings set value = '"stripe"' where key = 'payments'`);
await sql(`update settings set value = 'true' where key in ('stripe_ready', 'email_ready')`);
await sql(`update users set pw_hash = extensions.crypt('screenshots1', extensions.gen_salt('bf', 6)), stripe_ready = true, stripe_account_id = 'acct_demo' where username = 'sample_lantern'`);
await sql(`update users set display_name = (array['Priya N.','Jonah K.','Mei L.','Sam O.','Ana R.','Theo B.','Lucia M.','Kofi A.','Elise D.','Ravi P.'])[1 + (substr(username, 15)::int % 10)] where username like 'sample_backer_%'`);

const { startServer } = await import(path.join(GS, 'test/server.mjs'));
const srv = await startServer(8098);
const U = srv.origin + '/';
const browser = await chromium.launch();
const lantern = (await sql(`select id from projects where slug = 'lantern-keepers'`))[0].id;

// A backer account for the browsing screens, and a little activity for the creator.
const api = async (fn, args) => (await fetch(`${srv.origin}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: 'local', 'Content-Type': 'application/json' }, body: JSON.stringify(args) })).json();
const alex = await api('gs_signup', { p_username: 'alex', p_password: 'screenshots1', p_name: 'Alex Rivera' });
const login = await api('gs_login', { p_username: 'sample_lantern', p_password: 'screenshots1' });
for (const [who, body] of [['sample_backer_007', 'Played the prototype at Board Game Night. The lens dials are so satisfying!'], ['sample_backer_042', 'Will the solo mode be in the base box?'], ['sample_backer_118', 'Backed for two copies, one for my parents. Congrats on passing the goal!']]) {
  const [{ id }] = await sql(`select id from users where username = $1`, [who]);
  await sql(`insert into comments (project_id, user_id, body, created_at) values ($1, $2, $3, now() - (random() * interval '20 hours'))`, [lantern, id, body]);
  await sql(`insert into notifications (user_id, kind, project_id, actor_id, data, created_at) select creator_id, 'comment', id, $2, jsonb_build_object('excerpt', $3::text), now() - interval '2 hours' from projects where id = $1`, [lantern, id, body]);
}
await sql(`insert into notifications (user_id, kind, project_id, data, created_at) select creator_id, 'milestone', id, '{"pct":100}', now() - interval '3 days' from projects where id = $1`, [lantern]);

const sizes = [['iphone-6.9', 440, 956, 3], ['ipad-13', 1032, 1376, 2]];
fs.mkdirSync(OUT, { recursive: true });
for (const [label, w, h, scale] of sizes) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale, colorScheme: 'light' });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  const as = async token => { await p.goto(U); await p.evaluate(([t, me]) => { localStorage.setItem('gs.token', JSON.stringify(t)); localStorage.setItem('gs.me', JSON.stringify(me)); }, token); await p.goto(U); };
  const shot = async (hash, name, ready) => {
    await p.evaluate(h => { location.hash = h; window.scrollTo(0, 0); }, hash);
    await p.waitForSelector(ready); await p.waitForTimeout(900);
    await p.evaluate(() => { document.querySelectorAll('.toast').forEach(t => t.remove()); window.scrollTo(0, 0); });
    await p.screenshot({ path: path.join(OUT, `${label}-${name}.png`) });
  };
  await as([alex.token, alex.me]);
  await shot('#/', '1-discover', '.section-head');
  await shot('#/p/lantern-keepers', '2-project', '#pstats');
  await shot('#/p/lantern-keepers/pledge', '3-choose-reward', '[data-act=pl-pick]');
  await shot('#/explore', '5-explore', '.cards');
  await as([login.token, login.me]);
  await shot(`#/dash/${lantern}`, '4-dashboard', '#chart svg');
  await shot('#/activity', '6-activity', 'main .notes, main .empty');
  console.log(label, errs.length ? 'ERRORS: ' + errs.join(' | ') : 'ok');
  await ctx.close();
}
await browser.close(); await srv.close(); await su.end();
