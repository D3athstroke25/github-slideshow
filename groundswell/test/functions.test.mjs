// Tests for the `gs` Edge Function (supabase/functions/gs): payouts onboarding, saving cards at
// Checkout, Stripe webhooks, the worker's charging and emails. The function runs in-process
// against the local database, with mock-stripe.mjs standing in for Stripe and Resend.
import { execFileSync } from 'child_process';
import pg from 'pg';
import { startMockStripe, signedEvent } from './mock-stripe.mjs';

const PORT = Number(process.env.GS_PG_PORT || 54329);
Object.assign(process.env, {
  SUPABASE_URL: 'http://127.0.0.1:8098', SUPABASE_SERVICE_ROLE_KEY: 'service-test-key', GS_SERVICE_KEY: 'service-test-key',
  STRIPE_SECRET_KEY: 'sk_test_mock', STRIPE_API_BASE: 'http://127.0.0.1:8099', STRIPE_WEBHOOK_SECRET: 'whsec_test',
  RESEND_API_KEY: 're_test', RESEND_API_BASE: 'http://127.0.0.1:8099', GS_APP_URL: 'http://127.0.0.1:8098/',
  GS_EMAIL_FROM: 'Groundswell <hello@example.com>',
});
execFileSync(new URL('./reset-db.sh', import.meta.url).pathname, [String(PORT)], { stdio: 'inherit' });
const { startServer } = await import('./server.mjs');
const { handle } = await import('../supabase/functions/gs/index.ts');
const lib = await import('../supabase/functions/gs/lib.ts');
const stripeMock = await startMockStripe(8099);
const srv = await startServer(8098, { fn: handle });
const su = new pg.Pool({ host: '127.0.0.1', port: PORT, user: 'postgres', database: 'gs_test', max: 2 });
const sql = async (q, a = []) => (await su.query(q, a)).rows;
await sql(`insert into vault.decrypted_secrets values ('gs_worker_secret', 'test-worker-secret')`);

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (detail ? '  >> ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 400) : '')); }
};
async function block(name, f) {
  console.log('\n--- ' + name + ' ---');
  try { await f(); } catch (e) { ok(name + ' (crashed)', false, e.stack.split('\n').slice(0, 3).join(' | ')); }
}
const post = async (path, body, headers = {}) => {
  const r = await fetch(srv.origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const rpc = async (name, args) => {
  const r = await post('/rest/v1/rpc/' + name, args, { apikey: 'x' });
  if (r.status !== 200) throw new Error(`${name}: ${JSON.stringify(r.body)}`);
  return r.body;
};
const pay = (body) => post('/functions/v1/gs/pay', body);
const worker = (secret = 'test-worker-secret') => post('/functions/v1/gs/worker', {}, { 'x-worker-secret': secret });
const follow = async (url) => { const r = await fetch(url, { redirect: 'manual' }); return r.headers.get('location'); };

const STORY = 'A careful, honest story about what we are making and why it matters to the people who will use it. '.repeat(2);
let creator, backer, other, proj, lampReward;

await block('setup', async () => {
  creator = await rpc('gs_signup', { p_username: 'maker', p_password: 'makerpassword', p_name: 'Maker' });
  backer = await rpc('gs_signup', { p_username: 'payer', p_password: 'payerpassword', p_name: 'Payer <b>Bold</b>' });
  other = await rpc('gs_signup', { p_username: 'other', p_password: 'otherpassword', p_name: 'Other' });
  await sql(`update users set is_admin = true where username = 'maker'`);
  ok('health check answers', (await fetch(srv.origin + '/functions/v1/gs')).status === 200);
});

await block('worker', async () => {
  ok('wrong secret is refused', (await worker('nope')).status === 401);
  ok('missing secret is refused', (await post('/functions/v1/gs/worker', {})).status === 401);
  const w = await worker();
  ok('worker runs and reports Stripe and email as configured', w.status === 200 && (await rpc('gs_config', {})).stripe === true, w.body);
  const a = await rpc('gs_admin_settings', { p_token: creator.token, p_patch: { payments: 'stripe' } });
  ok('admin turns on real payments', a.settings.payments === 'stripe');
});

await block('creator payouts (Stripe Connect)', async () => {
  ok('pay needs a session', (await pay({ action: 'connect', token: 'bad' })).status === 401);
  const c = await pay({ action: 'connect', token: creator.token, return_base: 'https://evil.example/' });
  ok('connect returns an onboarding link', c.status === 200 && c.body.url.startsWith(stripeMock.base + '/connect/acct_'), c.body);
  const createReq = stripeMock.state.requests.find(r => r.path === '/v1/accounts');
  ok('express account in the platform country, with transfers', createReq.body.type === 'express' && createReq.body.country === 'CA' && createReq.body.capabilities.transfers.requested === 'true');
  ok('account creation is idempotent per user', createReq.headers['idempotency-key'] === `gs-acct-${creator.me.id}`);
  ok('requests pin the Stripe API version', createReq.headers['stripe-version'] === '2024-06-20');
  const linkReq = stripeMock.state.requests.find(r => r.path === '/v1/account_links');
  ok('unknown return bases fall back to the app', linkReq.body.return_url.startsWith('http://127.0.0.1:8098/return.html?to='));
  const again = await pay({ action: 'connect', token: creator.token });
  ok('reconnecting reuses the same account', stripeMock.state.requests.filter(r => r.path === '/v1/accounts').length === 1 && again.status === 200);
  let st = await pay({ action: 'connect_refresh', token: creator.token });
  ok('not ready before onboarding is finished', st.body.connected && !st.body.ready);
  const back = await follow(new URL(c.body.url.replace('/connect/', '/connect/').replace(/\?/, '/finish?')).toString());
  ok('onboarding returns to the app', back.startsWith('http://127.0.0.1:8098/return.html?to=%2Fsettings%3Fstripe%3Ddone'), back);
  st = await pay({ action: 'connect_refresh', token: creator.token });
  ok('ready once Stripe enables transfers and payouts', st.body.ready === true);
  const me = await rpc('gs_me', { p_token: creator.token });
  ok('profile shows payouts connected', me.me.stripe.ready === true);
  const d = await pay({ action: 'dashboard', token: creator.token });
  ok('Stripe dashboard link', d.body.url.includes('/express/acct_'));
  ok('backer without an account gets a clear message', (await pay({ action: 'dashboard', token: backer.token })).body.message === 'Connect Stripe first.');
});

await block('backing with a saved card', async () => {
  let e = await rpc('gs_project_new', { p_token: creator.token, p_title: 'Real money lamp', p_category: 'design', p_currency: 'CAD' });
  e = await rpc('gs_project_save', { p_token: creator.token, p_project: e.id, p_patch: { blurb: 'Funded with real (mock) money.', story: STORY, risks: 'Parts could be late; we have a second supplier lined up.', goal_cents: 15000 } });
  e = await rpc('gs_reward_save', { p_token: creator.token, p_project: e.id, p_reward: { title: 'Lamp', amount: 9000, ships: true, shipping: 1000 } });
  proj = await rpc('gs_project_launch', { p_token: creator.token, p_project: e.id });
  lampReward = proj.rewards[0];
  ok('launched as a Stripe project', proj.payments === 'stripe');
  const i = await rpc('gs_pledge', { p_token: backer.token, p_project: proj.id, p_reward: lampReward.id, p_amount: 11000 });
  ok('pledge waits for a card', i.needs_card === true);
  ok('someone else cannot open checkout for it', (await pay({ action: 'checkout', token: other.token, intent: i.intent })).status === 400);
  const co = await pay({ action: 'checkout', token: backer.token, intent: i.intent, return_base: 'http://127.0.0.1:8098/' });
  ok('checkout link returned', co.status === 200 && co.body.url.includes('/checkout/cs_test_'), co.body);
  const sReq = stripeMock.state.requests.find(r => r.path === '/v1/checkout/sessions');
  ok('setup-mode session in the project currency', sReq.body.mode === 'setup' && sReq.body.currency === 'cad' && sReq.body.metadata.gs_kind === 'intent' && sReq.body.metadata.gs_id === i.intent);
  ok('success link keeps Stripe\'s session placeholder', sReq.body.success_url.startsWith('http://127.0.0.1:8098/return.html?session={CHECKOUT_SESSION_ID}&to='));
  ok('checkout explains when the card is charged', /charged CA\$110 only if Real money lamp reaches its goal/.test(sReq.body.custom_text.submit.message), sReq.body.custom_text);
  ok('a Stripe customer was created for the backer', (await sql(`select stripe_customer_id from users where username = 'payer'`))[0].stripe_customer_id.startsWith('cus_'));
  const appCo = await pay({ action: 'checkout', token: backer.token, intent: i.intent, app: true });
  const appReq = stripeMock.state.requests.filter(r => r.path === '/v1/checkout/sessions').at(-1);
  ok('the iPhone app returns through return-app.html', appReq.body.success_url.includes('/return-app.html?session=') && appCo.status === 200);
  const pre = await pay({ action: 'confirm', token: backer.token, intent: i.intent });
  ok('confirm before paying says not done', pre.body.done === false);
  const loc = await follow(appCo.body.url + '/complete');
  const session = new URL(loc).searchParams.get('session');
  ok('Stripe sends the backer back with the session id', session.startsWith('cs_test_') && new URL(loc).searchParams.get('to') === `/p/${proj.slug}/paid?intent=${i.intent}`);
  const c = await pay({ action: 'confirm', token: backer.token, session });
  ok('confirming makes the pledge with the card', c.body.done && c.body.kind === 'intent' && c.body.pledge.card.last4 === '4242' && c.body.project.backers === 1, c.body);
  ok('confirming again is harmless', (await pay({ action: 'confirm', token: backer.token, intent: i.intent })).body.done === true);
  ok('another account cannot confirm it', (await pay({ action: 'confirm', token: other.token, session })).status === 403);
});

await block('webhooks', async () => {
  const bad = signedEvent('wrong_secret', 'account.updated', { id: 'acct_x' });
  ok('unsigned or wrongly signed events are refused', (await post('/functions/v1/gs/webhook', bad.body, { 'stripe-signature': bad.header })).status === 400);
  const stale = signedEvent('whsec_test', 'account.updated', { id: 'acct_x' }, Math.floor(Date.now() / 1000) - 600);
  ok('old events are refused', (await post('/functions/v1/gs/webhook', stale.body, { 'stripe-signature': stale.header })).status === 400);
  // Other backs it, closes the tab at Stripe; the webhook finishes the pledge.
  const i = await rpc('gs_pledge', { p_token: other.token, p_project: proj.id, p_reward: null, p_amount: 6000 });
  const co = await pay({ action: 'checkout', token: other.token, intent: i.intent });
  await follow(co.body.url + '/complete?card=declined');
  const sid = co.body.url.split('/').pop();
  const sess = stripeMock.state.sessions[sid];
  const ev = signedEvent('whsec_test', 'checkout.session.completed', { ...sess, setup_intent: sess.setup_intent });
  const r = await post('/functions/v1/gs/webhook', ev.body, { 'stripe-signature': ev.header });
  ok('checkout.session.completed makes the pledge', r.status === 200 && (await sql(`select backers_count from projects where id = $1`, [proj.id]))[0].backers_count === 2, r.body);
  const dup = await post('/functions/v1/gs/webhook', ev.body, { 'stripe-signature': ev.header });
  ok('repeated delivery is harmless', dup.status === 200 && (await sql(`select backers_count from projects where id = $1`, [proj.id]))[0].backers_count === 2);
  const acct = (await sql(`select stripe_account_id from users where username = 'maker'`))[0].stripe_account_id;
  const off = signedEvent('whsec_test', 'account.updated', { id: acct, capabilities: { transfers: 'inactive' }, payouts_enabled: false });
  await post('/functions/v1/gs/webhook', off.body, { 'stripe-signature': off.header });
  ok('account.updated can switch payouts off', (await sql(`select stripe_ready from users where username = 'maker'`))[0].stripe_ready === false);
  const on = signedEvent('whsec_test', 'account.updated', { id: acct, capabilities: { transfers: 'active' }, payouts_enabled: true });
  await post('/functions/v1/gs/webhook', on.body, { 'stripe-signature': on.header });
  ok('and back on', (await sql(`select stripe_ready from users where username = 'maker'`))[0].stripe_ready === true);
});

await block('charging funded pledges', async () => {
  await sql(`update projects set deadline = now() - interval '1 minute' where id = $1`, [proj.id]);
  const w = await worker();
  ok('worker charges one card and reports the declined one', w.body.charges === 1 && w.body.charge_failures === 1, w.body);
  const piReqs = stripeMock.state.requests.filter(r => r.path === '/v1/payment_intents');
  const good = piReqs.find(r => r.body.payment_method !== 'pm_card_declined');
  ok('destination charge to the creator with an 8% platform fee', good.body.amount === '11000' && good.body.currency === 'cad'
    && good.body.application_fee_amount === '880' && good.body.transfer_data.destination.startsWith('acct_') && good.body.off_session === 'true' && good.body.confirm === 'true', good.body);
  ok('charge is idempotent per pledge and card', good.headers['idempotency-key'].startsWith('gs-charge-') && good.headers['idempotency-key'].endsWith(good.body.payment_method));
  const rows = await sql(`select u.username, x.charge_status, x.charge_error, x.fix_by from pledges x join users u on u.id = x.backer_id where x.project_id = $1 order by x.backer_no`, [proj.id]);
  ok('statuses: paid and failed', rows[0].charge_status === 'paid' && rows[1].charge_status === 'failed' && /declined/.test(rows[1].charge_error) && rows[1].fix_by, rows);
  ok('worker has nothing left to charge', (await worker()).body.charges === 0);
  const view = await rpc('gs_project', { p_token: other.token, p_slug: proj.slug });
  const fix = await pay({ action: 'checkout', token: other.token, pledge: view.me.pledge.id });
  ok('backer with a failed charge can update the card', fix.status === 200, fix.body);
  const loc = await follow(fix.body.url + '/complete');
  const c = await pay({ action: 'confirm', token: other.token, session: new URL(loc).searchParams.get('session') });
  ok('new card queues the charge again', c.body.kind === 'fix' && c.body.pledge.charge_status === 'due' && c.body.pledge.card.last4 === '4242', c.body);
  ok('worker charges the new card', (await worker()).body.charges === 1);
  const d = await rpc('gs_dashboard', { p_token: creator.token, p_project: proj.id });
  ok('creator dashboard shows everything collected', d.payments.paid === 17000 && d.payments.failed_count === 0, d.payments);
  const ev = signedEvent('whsec_test', 'payment_intent.payment_failed', { id: 'pi_late', metadata: { gs_pledge: view.me.pledge.id }, last_payment_error: { message: 'late' } });
  await post('/functions/v1/gs/webhook', ev.body, { 'stripe-signature': ev.header });
  ok('a late failure event cannot undo a paid charge', (await sql(`select charge_status from pledges where id = $1`, [view.me.pledge.id]))[0].charge_status === 'paid');
});

await block('emails', async () => {
  await rpc('gs_email_set', { p_token: backer.token, p_email: 'payer@example.com' });
  await rpc('gs_email_set', { p_token: other.token, p_email: 'bounce@example.com' });
  const w = await worker();
  const sent = stripeMock.state.emails;
  const v = sent.find(m => m.to[0] === 'payer@example.com');
  ok('verification email sent through Resend', w.body.emails >= 1 && v && /^\d{6} is your Groundswell code$/.test(v.subject) && v.from === 'Groundswell <hello@example.com>', w.body);
  ok('it greets the person with their name escaped', v.html.includes('Payer &lt;b&gt;Bold&lt;/b&gt;') && !v.html.includes('<b>Bold'));
  const code = v.subject.slice(0, 6);
  ok('the code works', !!(await rpc('gs_email_verify', { p_token: backer.token, p_code: code })).me);
  ok('sent codes are erased from the queue', (await sql(`select count(*)::int n from outbox where data ? 'code' and status = 'sent'`))[0].n === 0);
  ok('a rejected address is retried, then given up', w.body.email_errors === 1);
  await worker(); await worker();
  ok('after 3 attempts the email is marked failed', (await sql(`select status from outbox where to_email = 'bounce@example.com'`))[0].status === 'failed');
  await rpc('gs_update_post', { p_token: creator.token, p_project: proj.id, p_title: 'Shipping <soon>', p_body: 'Packed.', p_backers_only: false });
  await worker();
  const u = stripeMock.state.emails.find(m => /Update #1/.test(m.subject));
  ok('update email links to the update', u && u.to[0] === 'payer@example.com' && u.html.includes(`#/p/${proj.slug}/updates/1`) && u.text.includes('“Shipping <soon>”') && u.html.includes('Shipping &lt;soon&gt;'), u && u.subject);
  await rpc('gs_reset_request', { p_username: 'payer' });
  await worker();
  const r = stripeMock.state.emails.find(m => m.subject === 'Reset your Groundswell password');
  const rc = r && r.text.match(/\n([A-Z0-9]{8})\n/);
  ok('reset email carries the code and a link', rc && r.html.includes('#/forgot?username=payer'));
  const reset = await rpc('gs_password_reset', { p_username: 'payer', p_code: rc[1], p_new: 'brandnewpw' });
  ok('emailed reset code works', !!reset.token);
});

await block('email templates', async () => {
  for (const kind of ['update', 'funded', 'ended', 'canceled', 'reply', 'comment', 'first_backer', 'milestone', 'ending_soon', 'survey', 'payment_failed', 'charged', 'whatever']) {
    const m = lib.renderEmail('notification', { kind, name: 'Sam', actor: '<img src=x>', data: { n: 2, title: 'T', pct: 50, amount: 1234, excerpt: '<script>', result: 'successful', role: 'backer', payments: 'stripe' }, project: { title: 'P & Q', slug: 'p-q', currency: 'USD', pledged: 5000 } });
    if (!m.subject || m.html.includes('<script>') || m.html.includes('<img src=x>')) { ok(`template ${kind}`, false, m.subject); }
  }
  ok('every notification kind renders safely', true);
  const f = lib.form({ a: 1, b: { c: 'x y', d: [1, { e: 2 }] }, z: null });
  ok('Stripe form encoding', f === 'a=1&b%5Bc%5D=x%20y&b%5Bd%5D%5B0%5D=1&b%5Bd%5D%5B1%5D%5Be%5D=2', f);
});

await block('payments switched off', async () => {
  const k = process.env.STRIPE_SECRET_KEY; delete process.env.STRIPE_SECRET_KEY;
  ok('pay explains payments are not set up', (await pay({ action: 'connect', token: creator.token })).status === 503);
  await worker();
  ok('worker reports Stripe as not configured', (await rpc('gs_config', {})).stripe === false && (await rpc('gs_config', {})).payments === 'test');
  process.env.STRIPE_SECRET_KEY = k;
});

await srv.close(); await stripeMock.close(); await su.end();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
