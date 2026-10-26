// API tests: every Groundswell database function, called the way the app calls it.
// Needs a local Postgres (see README.md); the database is rebuilt from the migrations first.
import { execFileSync } from 'child_process';
import pg from 'pg';
import { makePool, rpc } from './pgrpc.mjs';

const PORT = Number(process.env.GS_PG_PORT || 54329);
execFileSync(new URL('./reset-db.sh', import.meta.url).pathname, [String(PORT)], { stdio: 'inherit' });
const pool = makePool(PORT);
const su = new pg.Pool({ host: '127.0.0.1', port: PORT, user: 'postgres', database: 'gs_test', max: 2 });
const sql = async (q, a = []) => (await su.query(q, a)).rows;

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  >> ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : '')); }
};
const call = async (fn, args, opt) => rpc(pool, fn, args, opt);
const good = async (fn, args, opt) => {
  const r = await call(fn, args, opt);
  if (r.status !== 200) throw new Error(`${fn} failed: ${JSON.stringify(r.body)}`);
  return r.body;
};
const bad = async (name, fn, args, re) => {
  const r = await call(fn, args);
  ok(name, r.status !== 200 && (!re || re.test(r.body.message)), r.body);
  return r;
};
async function block(name, f) {
  console.log('\n--- ' + name + ' ---');
  try { await f(); } catch (e) { ok(name + ' (crashed)', false, e.stack.split('\n').slice(0, 3).join(' | ')); }
}

const STORY = 'We have spent two years designing this, testing prototypes with people who use it every day. '.repeat(3);
const RISKS = 'Manufacturing could slip by a month or two; we have a buffer and a backup supplier.';
async function launchedProject(token, extra = {}) {
  let e = await good('gs_project_new', { p_token: token, p_title: extra.title || 'Tidepool Lamp', p_category: 'design' });
  e = await good('gs_project_save', { p_token: token, p_project: e.id, p_patch: { blurb: 'A modular desk lamp that grows with you.', story: STORY, risks: RISKS, goal_cents: extra.goal ?? 100000, duration_days: 30 } });
  e = await good('gs_reward_save', { p_token: token, p_project: e.id, p_reward: { title: 'Early bird', amount: 2500, ships: true, shipping: 500, limit: extra.limit ?? null, items: ['Lamp', 'Sticker'], est_delivery: '2027-03' } });
  e = await good('gs_reward_save', { p_token: token, p_project: e.id, p_reward: { title: 'Digital thanks', amount: 500 } });
  e = await good('gs_project_launch', { p_token: token, p_project: e.id });
  return e;
}

let alice, bob, cara, dan;

await block('accounts', async () => {
  await bad('rejects short username', 'gs_signup', { p_username: 'ab', p_password: 'password1', p_name: 'A' }, /3 to 24/);
  await bad('rejects reserved username', 'gs_signup', { p_username: 'admin', p_password: 'password1', p_name: 'A' }, /reserved/);
  await bad('rejects short password', 'gs_signup', { p_username: 'alice', p_password: 'short', p_name: 'A' }, /8 characters/);
  const a = await good('gs_signup', { p_username: 'Alice', p_password: 'correct horse', p_name: 'Alice Maker' });
  ok('signup returns a token, recovery code and profile', a.token && /^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/.test(a.recovery) && a.me.username === 'alice', a);
  alice = a;
  await bad('duplicate username refused', 'gs_signup', { p_username: 'alice', p_password: 'password1', p_name: 'X' }, /taken/);
  bob = await good('gs_signup', { p_username: 'bob', p_password: 'bobpassword', p_name: 'Bob Backer' });
  cara = await good('gs_signup', { p_username: 'cara', p_password: 'carapassword', p_name: 'Cara' });
  dan = await good('gs_signup', { p_username: 'dan', p_password: 'danpassword', p_name: 'Dan' });

  const stored = await sql(`select pw_hash, recovery_hash from users where username = 'alice'`);
  ok('password stored as bcrypt, not plain text', stored[0].pw_hash.startsWith('$2a$') && !stored[0].pw_hash.includes('correct'));
  const sess = await sql(`select count(*)::int n from sessions s join users u on u.id = s.user_id where u.username = 'alice'`);
  ok('one session row per sign-in', sess[0].n === 1);

  const wrong = await good('gs_login', { p_username: 'alice', p_password: 'nope' });
  ok('wrong password returns an error message', wrong.error === 'Wrong username or password.', wrong);
  const fails = await sql(`select failed_logins from users where username = 'alice'`);
  ok('failed attempt is counted (not rolled back)', fails[0].failed_logins === 1, fails);
  const unknown = await good('gs_login', { p_username: 'nobody', p_password: 'x' });
  ok('unknown user gives the same message', unknown.error === 'Wrong username or password.');
  const li = await good('gs_login', { p_username: ' ALICE ', p_password: 'correct horse' });
  ok('login is case-insensitive on username and returns a new token', li.token && li.token !== alice.token);
  ok('successful login resets the failure count', (await sql(`select failed_logins from users where username='alice'`))[0].failed_logins === 0);

  for (let i = 0; i < 10; i++) await good('gs_login', { p_username: 'dan', p_password: 'wrong' });
  const locked = await good('gs_login', { p_username: 'dan', p_password: 'danpassword' });
  ok('account locks after 10 wrong passwords', /locked/.test(locked.error || ''), locked);
  await sql(`update users set locked_until = null where username = 'dan'`);

  const me = await good('gs_me', { p_token: alice.token });
  ok('gs_me returns the profile and unread count', me.me.name === 'Alice Maker' && me.unread === 0);
  const r = await bad('bad token is refused with hint=auth', 'gs_me', { p_token: 'not-a-token' });
  ok('auth hint is set for the client', r.body.hint === 'auth');

  const ps = await good('gs_profile_save', { p_token: bob.token, p_patch: { bio: 'I back weird lamps.', location: 'Toronto, ON', show_backed: true } });
  ok('profile save', ps.bio === 'I back weird lamps.' && ps.show_backed === true);
  await bad('empty display name refused', 'gs_profile_save', { p_token: bob.token, p_patch: { name: '  ' } }, /name/);
  await bad('avatar must be an uploaded path', 'gs_profile_save', { p_token: bob.token, p_patch: { avatar: 'u/elsewhere/x.jpg' } }, /upload/);
});

await block('direct table access is blocked', async () => {
  const c = await pool.connect();
  for (const q of ['select * from users', 'select * from sessions', 'select * from pledges', 'insert into throttle(key) values (1)', 'select public.gs_settle()', 'select public.gs_uid(null)', 'select public.gs_card(null, null)']) {
    try {
      await c.query('begin'); await c.query('set local role anon'); await c.query(q); ok('anon blocked: ' + q, false, 'query succeeded');
    } catch (e) { ok('anon blocked: ' + q, e.code === '42501', e.message); }
    finally { await c.query('rollback'); }
  }
  c.release();
});

let proj;
await block('creating and launching a project', async () => {
  let e = await good('gs_project_new', { p_token: alice.token, p_title: 'Tidepool: a modular lamp!', p_category: 'design', p_currency: 'CAD' });
  ok('draft created with slug from title', e.status === 'draft' && e.slug === 'tidepool-a-modular-lamp' && e.currency === 'CAD', e.slug);
  await bad('unknown category refused', 'gs_project_new', { p_token: alice.token, p_title: 'X', p_category: 'weapons' }, /category/);
  await bad('others cannot open the editor', 'gs_project_edit', { p_token: bob.token, p_project: e.id }, /find/);
  await bad('launch blocked until checklist is done', 'gs_project_launch', { p_token: alice.token, p_project: e.id }, /Still to do/);
  ok('checklist lists the missing pieces', e.checklist.filter(x => !x.ok).map(x => x.key).join() === 'blurb,rewards,story,risks', e.checklist);

  await bad('non-YouTube/Vimeo video refused', 'gs_project_save', { p_token: alice.token, p_project: e.id, p_patch: { video: 'https://evil.example/x' } }, /YouTube/);
  await bad('goal below 1 refused', 'gs_project_save', { p_token: alice.token, p_project: e.id, p_patch: { goal_cents: 50 } }, /at least/);
  await bad('non-numeric goal refused nicely', 'gs_project_save', { p_token: alice.token, p_project: e.id, p_patch: { goal_cents: 'lots' } }, /valid number/);
  e = await good('gs_project_save', { p_token: alice.token, p_project: e.id, p_patch: {
    title: 'Tidepool Lamp', blurb: 'A modular desk lamp that grows with you.', story: STORY, risks: RISKS, goal_cents: 200000,
    duration_days: 21, location: 'Halifax, NS', video: 'https://www.youtube.com/watch?v=abc123',
    faqs: [{ q: 'Does it dim?', a: 'Yes, smoothly.' }, { q: '  ', a: 'dropped' }, { q: 'Warranty?', a: 'Two years.' }] } });
  ok('save applies fields and re-slugs a draft', e.slug === 'tidepool-lamp' && e.goal === 200000 && e.duration === 21 && e.location === 'Halifax, NS');
  ok('blank FAQ entries are dropped', e.faqs.length === 2 && e.faqs[1].q === 'Warranty?');

  await bad('reward needs a title', 'gs_reward_save', { p_token: alice.token, p_project: e.id, p_reward: { title: '', amount: 1000 } }, /title/);
  await bad('reward amount minimum', 'gs_reward_save', { p_token: alice.token, p_project: e.id, p_reward: { title: 'X', amount: 10 } }, /start at/);
  await bad('bad delivery month', 'gs_reward_save', { p_token: alice.token, p_project: e.id, p_reward: { title: 'X', amount: 1000, est_delivery: 'soon' } }, /delivery/);
  e = await good('gs_reward_save', { p_token: alice.token, p_project: e.id, p_reward: { title: 'The Lamp', amount: 12000, ships: true, shipping: 1500, items: ['Lamp', ' ', 'Cable'], est_delivery: '2027-04', limit: 2 } });
  e = await good('gs_reward_save', { p_token: alice.token, p_project: e.id, p_reward: { title: 'Thank you', amount: 500, ships: false, shipping: 999 } });
  ok('rewards sorted by price, items cleaned, no shipping when not shipped', e.rewards[0].title === 'Thank you' && e.rewards[0].shipping === 0 && e.rewards[1].items.length === 2 && e.rewards[1].est_delivery === '2027-04');

  const other = await good('gs_project', { p_token: bob.token, p_slug: e.slug }).catch(x => x);
  ok('drafts are hidden from other people', other instanceof Error && /couldn/.test(other.message));
  const anon = await call('gs_project', { p_token: null, p_slug: e.slug });
  ok('drafts are hidden from signed-out visitors', anon.status === 400 && anon.body.hint === 'notfound', anon.body);
  const anonC = await call('gs_comments', { p_token: null, p_project: e.id });
  ok('draft comments hidden from signed-out visitors', anonC.status === 400);
  const prev = await good('gs_project', { p_token: bob.token, p_slug: e.slug, p_preview: e.preview_key });
  ok('draft visible with the preview link', prev.project.title === 'Tidepool Lamp' && prev.project.preview_key === null);

  e = await good('gs_project_launch', { p_token: alice.token, p_project: e.id });
  const days = (new Date(e.deadline) - new Date(e.launched_at)) / 864e5;
  ok('launch sets live status and deadline = duration', e.status === 'live' && Math.round(days) === 21, e);
  await bad('goal is locked after launch', 'gs_project_save', { p_token: alice.token, p_project: e.id, p_patch: { goal_cents: 1 } }, /locked/);
  const same = await good('gs_project_save', { p_token: alice.token, p_project: e.id, p_patch: { goal_cents: 200000, currency: 'CAD', duration_days: 21, title: 'Tidepool Lamp 2' } });
  ok('unchanged locked fields are fine; slug stays after launch', same.slug === 'tidepool-lamp' && same.title === 'Tidepool Lamp 2');
  await bad('launched projects cannot be deleted', 'gs_project_delete', { p_token: alice.token, p_project: e.id }, /cancel/);
  proj = same;
});

await block('backing', async () => {
  const [thanks, lamp] = proj.rewards;
  await bad('creator cannot back their own project', 'gs_pledge', { p_token: alice.token, p_project: proj.id, p_reward: null, p_amount: 1000 }, /own project/);
  await bad('below reward + shipping refused', 'gs_pledge', { p_token: bob.token, p_project: proj.id, p_reward: lamp.id, p_amount: 12000 }, /CA\$135/);
  await bad('signed-out pledge refused', 'gs_pledge', { p_token: null, p_project: proj.id, p_reward: null, p_amount: 1000 }, /log in/);
  let r = await good('gs_pledge', { p_token: bob.token, p_project: proj.id, p_reward: lamp.id, p_amount: 15000 });
  ok('pledge recorded as backer #1 with shipping', r.pledge.backer_no === 1 && r.pledge.shipping === 1500 && r.project.pledged === 15000 && r.project.backers === 1 && r.first);
  r = await good('gs_pledge', { p_token: bob.token, p_project: proj.id, p_reward: lamp.id, p_amount: 20000 });
  ok('raising a pledge updates it in place', r.pledge.backer_no === 1 && r.project.pledged === 20000 && r.project.backers === 1 && !r.first);
  r = await good('gs_pledge', { p_token: cara.token, p_project: proj.id, p_reward: lamp.id, p_amount: 13500 });
  ok('second backer #2', r.pledge.backer_no === 2 && r.project.backers === 2);
  await bad('limited reward sells out', 'gs_pledge', { p_token: dan.token, p_project: proj.id, p_reward: lamp.id, p_amount: 13500 }, /sold out/);
  r = await good('gs_pledge', { p_token: bob.token, p_project: proj.id, p_reward: lamp.id, p_amount: 20000 });
  ok('holder of a sold-out reward can still edit their pledge', r.pledge.reward_id === lamp.id);
  r = await good('gs_pledge', { p_token: dan.token, p_project: proj.id, p_reward: null, p_amount: 100 });
  ok('pledge without a reward', r.pledge.reward_id === null && r.project.backers === 3);

  const view = await good('gs_project', { p_token: bob.token, p_slug: proj.slug });
  ok('project page shows my pledge and counts', view.me.pledge.amount === 20000 && view.me.backer && view.rewards.find(x => x.id === lamp.id).left === 0, view.me);
  ok('community counts backers', view.community.backers === 3);

  await bad('price of a backed reward is locked', 'gs_reward_save', { p_token: alice.token, p_project: proj.id, p_reward: { ...lamp, amount: 9000 } }, /locked/);
  const renamed = await good('gs_reward_save', { p_token: alice.token, p_project: proj.id, p_reward: { ...lamp, title: 'The Lamp (first run)' } });
  ok('title of a backed reward can change', renamed.rewards.find(x => x.id === lamp.id).title === 'The Lamp (first run)');
  await bad('limit cannot go below backers', 'gs_reward_save', { p_token: alice.token, p_project: proj.id, p_reward: { ...lamp, limit: 1 } }, /below/);
  await bad('backed reward cannot be deleted', 'gs_reward_delete', { p_token: alice.token, p_reward: lamp.id }, /backers/);

  r = await good('gs_pledge_cancel', { p_token: cara.token, p_project: proj.id });
  ok('cancel drops totals', r.project.backers === 2 && r.project.pledged === 20100);
  r = await good('gs_pledge', { p_token: cara.token, p_project: proj.id, p_reward: lamp.id, p_amount: 13500 });
  ok('re-pledge after cancel gets a new backer number', r.pledge.backer_no === 4, r.pledge);

  const notes = await good('gs_notifications', { p_token: alice.token });
  const kinds = notes.items.map(n => n.kind);
  ok('creator told about first backer', kinds.includes('first_backer'));
  ok('no milestone yet at 17%', !kinds.includes('milestone'), kinds);

  const ev = await sql(`select sum(delta_cents)::int c, sum(delta_backers)::int b from pledge_events where project_id = $1`, [proj.id]);
  const pj = await sql(`select pledged_cents::int c, backers_count b from projects where id = $1`, [proj.id]);
  ok('event log sums to the project total', ev[0].c === pj[0].c && ev[0].b === pj[0].b, { ev: ev[0], pj: pj[0] });
});

await block('funding milestone notifies backers', async () => {
  const r = await good('gs_pledge', { p_token: dan.token, p_project: proj.id, p_reward: null, p_amount: 200000 });
  ok('pledge pushes past goal', r.project.pledged >= r.project.goal);
  const bobN = await good('gs_notifications', { p_token: bob.token });
  ok('other backers hear it was funded', bobN.items.some(n => n.kind === 'funded'));
  const danN = await good('gs_notifications', { p_token: dan.token });
  ok('the backer who tipped it is not double-notified', !danN.items.some(n => n.kind === 'funded'));
  const aliceN = await good('gs_notifications', { p_token: alice.token });
  const ms = aliceN.items.filter(n => n.kind === 'milestone');
  ok('one milestone note for the biggest step crossed (100%)', ms.length === 1 && ms[0].data.pct === 100, ms);
  await bad('pledges are capped at 10,000', 'gs_pledge', { p_token: dan.token, p_project: proj.id, p_reward: null, p_amount: 1000001 }, /limited/);
});

await block('comments', async () => {
  const outsider = await good('gs_signup', { p_username: 'erin', p_password: 'erinpassword', p_name: 'Erin' });
  await bad('non-backers cannot comment', 'gs_comment_post', { p_token: outsider.token, p_project: proj.id, p_body: 'Hi' }, /Only backers/);
  const c1 = await good('gs_comment_post', { p_token: bob.token, p_project: proj.id, p_body: 'Love the colors!' });
  const c2 = await good('gs_comment_post', { p_token: alice.token, p_project: proj.id, p_parent: c1.id, p_body: 'Thank you Bob!' });
  const c3 = await good('gs_comment_post', { p_token: cara.token, p_project: proj.id, p_parent: c2.id, p_body: 'Same here.' });
  const list = await good('gs_comments', { p_token: outsider.token, p_project: proj.id });
  ok('anyone can read comments', list.items.length === 3 && list.can_comment === false);
  const anonList = await good('gs_comments', { p_token: null, p_project: proj.id });
  ok('signed-out flags are false, not null', anonList.can_comment === false && anonList.items.every(c => c.mine === false && c.can_delete === false));
  const anonView = await good('gs_project', { p_token: null, p_slug: proj.slug });
  ok('signed-out project flags are false', anonView.me.creator === false && anonView.me.can_comment === false && anonView.me.saved === false);
  ok('replies to replies attach to the top comment', list.items.find(x => x.id === c3.id).parent === c1.id);
  ok('badges for creator and backer', list.items.find(x => x.id === c2.id).badge === 'creator' && list.items.find(x => x.id === c1.id).badge === 'backer');
  const aliceN = await good('gs_notifications', { p_token: alice.token });
  ok('creator notified of comments', aliceN.items.filter(n => n.kind === 'comment').length === 2);
  const bobN = await good('gs_notifications', { p_token: bob.token });
  ok('commenter notified of a reply', bobN.items.some(n => n.kind === 'reply' && n.actor.username === 'cara'));
  await bad('cannot delete someone else\'s comment', 'gs_comment_delete', { p_token: cara.token, p_comment: c1.id }, /own/);
  await good('gs_comment_delete', { p_token: alice.token, p_comment: c3.id });
  const after = await good('gs_comments', { p_token: null, p_project: proj.id });
  const d = after.items.find(x => x.id === c3.id);
  ok('creator can delete; body and author are hidden', d.deleted && d.body === '' && d.author === null);
  await bad('empty comment refused', 'gs_comment_post', { p_token: bob.token, p_project: proj.id, p_body: '   ' }, /Write/);
});

await block('updates', async () => {
  await bad('only the creator posts updates', 'gs_update_post', { p_token: bob.token, p_project: proj.id, p_title: 'X', p_body: 'Y' }, /find/);
  const u1 = await good('gs_update_post', { p_token: alice.token, p_project: proj.id, p_title: 'Prototype #4 is here', p_body: 'Photos inside.', p_backers_only: false });
  const u2 = await good('gs_update_post', { p_token: alice.token, p_project: proj.id, p_title: 'Backer survey', p_body: 'Secret details.', p_backers_only: true });
  ok('updates are numbered', u1.n === 1 && u2.n === 2);
  const pub = await good('gs_project', { p_token: null, p_slug: proj.slug });
  const pu2 = pub.updates.find(x => x.n === 2);
  ok('backers-only body hidden from the public', pu2.body === null && pub.updates.find(x => x.n === 1).body === 'Photos inside.');
  const bk = await good('gs_project', { p_token: bob.token, p_slug: proj.slug });
  ok('backers see backers-only updates', bk.updates.find(x => x.n === 2).body === 'Secret details.');
  const bobN = await good('gs_notifications', { p_token: bob.token });
  ok('backers notified of new updates', bobN.items.filter(n => n.kind === 'update').length === 2);
  await good('gs_comment_post', { p_token: bob.token, p_project: proj.id, p_update: u2.id, p_body: 'Done!' });
  const locked = await good('gs_comments', { p_token: null, p_project: proj.id, p_update: u2.id });
  ok('comments on backers-only updates are hidden too', locked.locked && locked.items.length === 0);
  const projectThread = await good('gs_comments', { p_token: null, p_project: proj.id });
  ok('update comments stay out of the project thread', !projectThread.items.some(c => c.body === 'Done!'));
  await good('gs_update_post', { p_token: alice.token, p_project: proj.id, p_id: u1.id, p_title: 'Prototype #4 (edited)', p_body: 'More photos.', p_backers_only: false });
  const ed = await good('gs_project', { p_token: null, p_slug: proj.slug });
  ok('edit an update', ed.updates.find(x => x.n === 1).title === 'Prototype #4 (edited)' && ed.updates.find(x => x.n === 1).edited_at);
  await good('gs_notifications_read', { p_token: bob.token });
  ok('mark notifications read', (await good('gs_me', { p_token: bob.token })).unread === 0);
});

await block('discovery', async () => {
  const p2 = await launchedProject(bob.token, { title: 'The Lantern Keepers board game', goal: 500000 });
  await sql(`update projects set category = 'games', location = 'Montreal, QC' where id = $1`, [p2.id]);
  const p3 = await launchedProject(cara.token, { title: 'Rooftop hot sauce', goal: 50000 });
  await sql(`update projects set category = 'food' where id = $1`, [p3.id]);
  await good('gs_pledge', { p_token: dan.token, p_project: p3.id, p_reward: null, p_amount: 40000 });

  const home = await good('gs_home', { p_token: dan.token });
  ok('home has a featured project and sections', home.featured && Array.isArray(home.trending) && home.trending.length === 3 && home.ending.length === 3);
  ok('home stats', home.stats.live === 3 && home.stats.backers >= 3, home.stats);
  ok('category counts', home.categories.games === 1 && home.categories.food === 1 && home.categories.design === 1);
  ok('nearly funded shows the 80% project', home.nearly.some(p => p.id === p3.id));

  let ex = await good('gs_explore', { p_token: null, p_q: 'lantern', p_category: '', p_state: 'live', p_sort: 'magic', p_offset: 0 });
  ok('search by title', ex.items.length === 1 && ex.items[0].id === p2.id);
  ex = await good('gs_explore', { p_token: null, p_q: 'montreal', p_category: '', p_state: 'live', p_sort: 'magic', p_offset: 0 });
  ok('search by location', ex.items.length === 1);
  ex = await good('gs_explore', { p_token: null, p_q: 'Alice', p_category: '', p_state: 'all', p_sort: 'magic', p_offset: 0 });
  ok('search by creator name', ex.items.length === 1 && ex.items[0].id === proj.id);
  ex = await good('gs_explore', { p_token: null, p_q: '100%_', p_category: '', p_state: 'all', p_sort: 'magic', p_offset: 0 });
  ok('LIKE wildcards in search are literal', ex.items.length === 0);
  ex = await good('gs_explore', { p_token: null, p_q: '', p_category: 'food', p_state: 'live', p_sort: 'magic', p_offset: 0 });
  ok('category filter', ex.items.length === 1 && ex.items[0].category === 'food');
  ex = await good('gs_explore', { p_token: null, p_q: '', p_category: '', p_state: 'live', p_sort: 'funded', p_offset: 0 });
  ok('sort by percent funded', ex.items[0].id === proj.id && ex.total === 3, ex.items.map(i => i.title));
  ex = await good('gs_explore', { p_token: null, p_q: '', p_category: '', p_state: 'live', p_sort: 'newest', p_offset: 0 });
  ok('sort by newest', ex.items[0].id === p3.id);
  ex = await good('gs_explore', { p_token: null, p_q: '', p_category: '', p_state: 'live', p_sort: 'newest', p_offset: 2 });
  ok('paging', ex.items.length === 1 && ex.more === false);

  await good('gs_save', { p_token: dan.token, p_project: p2.id, p_on: true });
  const mine = await good('gs_mine', { p_token: dan.token });
  ok('my backed and saved projects', mine.backed.length === 2 && mine.saved.length === 1 && mine.backed[0].pledge.amount > 0);
  const saved = await good('gs_explore', { p_token: dan.token, p_q: 'lantern', p_category: '', p_state: 'live', p_sort: 'magic', p_offset: 0 });
  ok('cards show saved state for the viewer', saved.items[0].saved === true);

  const profPub = await good('gs_user', { p_token: null, p_username: 'dan' });
  ok('backed list private by default', profPub.backed === null && profPub.user.backed_count === 2);
  const profSelf = await good('gs_user', { p_token: dan.token, p_username: 'dan' });
  ok('self sees backed list', profSelf.backed.length === 2);
  const profBob = await good('gs_user', { p_token: null, p_username: 'bob' });
  ok('public backed list when opted in', Array.isArray(profBob.backed) && profBob.created.length === 1);

  // 48-hour reminder for saved projects
  await sql(`update projects set deadline = now() + interval '20 hours' where id = $1`, [p2.id]);
  await good('gs_home', {});
  const dn = await good('gs_notifications', { p_token: dan.token });
  ok('saved project ending soon reminder (once)', dn.items.filter(n => n.kind === 'ending_soon').length === 1);
  await good('gs_home', {});
  ok('reminder not repeated', (await good('gs_notifications', { p_token: dan.token })).items.filter(n => n.kind === 'ending_soon').length === 1);
});

await block('dashboard', async () => {
  await bad('only the creator sees the dashboard', 'gs_dashboard', { p_token: bob.token, p_project: proj.id }, /find/);
  const d = await good('gs_dashboard', { p_token: alice.token, p_project: proj.id });
  ok('dashboard has backers, series and updates', d.backers.length === 3 && d.series.length >= 1 && d.updates.length === 2 && d.canceled === 0);
  ok('series ends at the current total', d.series.at(-1).pledged === d.project.pledged, { last: d.series.at(-1), pledged: d.project.pledged });
  ok('backer rows include reward titles', d.backers.some(b => b.reward === 'The Lamp (first run)'));
});

await block('all-or-nothing settlement', async () => {
  const p4 = await launchedProject(cara.token, { title: 'Underfunded film', goal: 1000000 });
  await good('gs_pledge', { p_token: bob.token, p_project: p4.id, p_reward: null, p_amount: 5000 });
  await sql(`update projects set deadline = now() - interval '1 minute' where id in ($1, $2)`, [proj.id, p4.id]);
  const view = await good('gs_project', { p_token: bob.token, p_slug: proj.slug });
  ok('funded project becomes successful at its deadline', view.project.status === 'successful' && view.me.pledge.status === 'collected', view.project.status);
  const v4 = await good('gs_project', { p_token: bob.token, p_slug: p4.slug });
  ok('underfunded project becomes unsuccessful, pledge dropped', v4.project.status === 'unsuccessful' && v4.me.pledge.status === 'dropped');
  ok('final totals stay visible after the end', v4.project.pledged === 5000 && view.project.pledged > 0);
  await bad('no pledges after the deadline', 'gs_pledge', { p_token: dan.token, p_project: proj.id, p_reward: null, p_amount: 1000 }, /no longer/);
  await bad('no pledge changes after the deadline', 'gs_pledge_cancel', { p_token: bob.token, p_project: proj.id }, /active pledge|ended/);
  const bn = await good('gs_notifications', { p_token: bob.token });
  ok('backers told the result', bn.items.filter(n => n.kind === 'ended').length === 2);
  const an = await good('gs_notifications', { p_token: alice.token });
  ok('creator told the result', an.items.some(n => n.kind === 'ended' && n.data.result === 'successful'));
  const dash = await good('gs_dashboard', { p_token: alice.token, p_project: proj.id });
  ok('dashboard still works after the end', dash.project.status === 'successful');
  const post = await good('gs_update_post', { p_token: alice.token, p_project: proj.id, p_title: 'Shipping news', p_body: 'Boxes are packed.', p_backers_only: false });
  ok('updates can be posted after success', post.n === 3);
  await bad('no new rewards after the end', 'gs_reward_save', { p_token: alice.token, p_project: proj.id, p_reward: { title: 'Late', amount: 100 } }, /before the campaign ends/);
  const funded = await good('gs_explore', { p_token: null, p_q: '', p_category: '', p_state: 'successful', p_sort: 'magic', p_offset: 0 });
  ok('explore successful projects', funded.items.length === 1 && funded.items[0].id === proj.id);
});

await block('canceling a project', async () => {
  const p5 = await launchedProject(dan.token, { title: 'Pocket weather station' });
  await good('gs_pledge', { p_token: bob.token, p_project: p5.id, p_reward: null, p_amount: 2500 });
  await bad('others cannot cancel', 'gs_project_cancel', { p_token: bob.token, p_project: p5.id }, /find/);
  const c = await good('gs_project_cancel', { p_token: dan.token, p_project: p5.id });
  ok('canceled', c.status === 'canceled');
  const bn = await good('gs_notifications', { p_token: bob.token });
  ok('backers told of cancellation', bn.items.some(n => n.kind === 'canceled'));
  const mine = await good('gs_mine', { p_token: bob.token });
  ok('pledge shown as dropped', mine.backed.find(x => x.id === p5.id).pledge.status === 'dropped');
  await bad('canceled projects cannot be edited', 'gs_project_save', { p_token: dan.token, p_project: p5.id, p_patch: { blurb: 'x' } }, /canceled/);
});

await block('uploads and storage policy', async () => {
  const t = await good('gs_upload_ticket', { p_token: bob.token, p_kind: 'avatar' });
  ok('ticket path is under the user', t.path.startsWith('u/' + bob.me.id + '/avatar-') && t.path.endsWith('.jpg'));
  await bad('unknown kind refused', 'gs_upload_ticket', { p_token: bob.token, p_kind: 'exe' }, /Unknown/);
  const c = await pool.connect();
  const tryInsert = async (name) => {
    try { await c.query('begin'); await c.query('set local role anon'); await c.query(`insert into storage.objects (bucket_id, name) values ('media', $1)`, [name]); await c.query('commit'); return true; }
    catch (e) { await c.query('rollback'); return e.code; }
  };
  ok('storage accepts the ticketed path', (await tryInsert(t.path)) === true);
  ok('storage refuses other paths', (await tryInsert('u/' + bob.me.id + '/avatar-made-up.jpg')) === '42501');
  ok('storage refuses other buckets', (await tryInsert(t.path.replace('avatar', 'cover'))) === '42501');
  c.release();
  await sql(`update uploads set created_at = now() - interval '31 minutes' where path = $1`, [t.path]);
  ok('tickets expire after 30 minutes', (await sql(`select public.gs_ticket_ok($1) ok`, [t.path]))[0].ok === false);
  const me = await good('gs_profile_save', { p_token: bob.token, p_patch: { avatar: t.path } });
  ok('avatar set to own uploaded path', me.avatar === t.path);
  await bad('cannot use someone else\'s upload', 'gs_profile_save', { p_token: cara.token, p_patch: { avatar: t.path } }, /upload/);
});

await block('password reset and recovery', async () => {
  const old = await good('gs_login', { p_username: 'cara', p_password: 'carapassword' });
  const wrong = await good('gs_password_reset', { p_username: 'cara', p_code: 'AAAA-BBBB-CCCC-DDDD', p_new: 'newpassword' });
  ok('wrong recovery code refused', /match/.test(wrong.error || ''));
  const r = await good('gs_password_reset', { p_username: 'cara', p_code: cara.recovery.toLowerCase().replace(/-/g, ' '), p_new: 'newpassword' });
  ok('reset with recovery code (any case/spacing) works', r.token && r.recovery && r.recovery !== cara.recovery, r);
  const oldMe = await call('gs_me', { p_token: old.token });
  ok('old sessions are signed out', oldMe.status !== 200);
  ok('new password works', (await good('gs_login', { p_username: 'cara', p_password: 'newpassword' })).token);
  const reuse = await good('gs_password_reset', { p_username: 'cara', p_code: cara.recovery, p_new: 'another1' });
  ok('old recovery code no longer works', !!reuse.error);
  cara = { ...cara, token: r.token, recovery: r.recovery };

  await bad('change password needs the current one', 'gs_password_change', { p_token: cara.token, p_old: 'nope', p_new: 'brandnew1' }, /current/);
  await good('gs_password_change', { p_token: cara.token, p_old: 'newpassword', p_new: 'brandnew1' });
  ok('changed password works', (await good('gs_login', { p_username: 'cara', p_password: 'brandnew1' })).token);
  const rc = await good('gs_recovery_new', { p_token: cara.token, p_password: 'brandnew1' });
  ok('new recovery code issued', /^[A-Z0-9]{4}-/.test(rc.recovery));
  await good('gs_logout', { p_token: cara.token });
  ok('logout ends the session', (await call('gs_me', { p_token: cara.token })).status === 400);
});

await block('throttling', async () => {
  const p6 = await launchedProject(alice.token, { title: 'Throttle test' });
  await good('gs_pledge', { p_token: bob.token, p_project: p6.id, p_reward: null, p_amount: 100 });
  let last;
  for (let i = 0; i < 21; i++) last = await call('gs_comment_post', { p_token: bob.token, p_project: p6.id, p_body: 'spam ' + i });
  ok('21st comment in 10 minutes is refused', last.status === 400 && /fast/.test(last.body.message), last.body);
  let s;
  for (let i = 0; i < 21; i++) s = await call('gs_signup', { p_username: 'spam' + i, p_password: 'password1' }, { ip: '203.0.113.9' });
  ok('signups per network are limited', s.status === 400 && /network/.test(s.body.message), s.body);
  const other = await call('gs_signup', { p_username: 'fromelsewhere', p_password: 'password1' }, { ip: '198.51.100.2' });
  ok('other networks unaffected', other.status === 200);
});

await block('moderation', async () => {
  await bad('admin tools need admin', 'gs_admin', { p_token: bob.token }, /Admins/);
  await good('gs_report', { p_token: bob.token, p_project: proj.id, p_reason: 'Looks like a copy of another product.' });
  await sql(`update users set is_admin = true where username = 'alice'`);
  const a = await good('gs_admin', { p_token: alice.token });
  ok('admin sees reports', a.reports.length === 1 && a.reports[0].project.slug === proj.slug);
  await good('gs_admin_set', { p_token: alice.token, p_project: proj.id, p_field: 'hidden', p_on: true });
  const hidden = await call('gs_project', { p_token: bob.token, p_slug: proj.slug });
  ok('hidden projects disappear for others', hidden.status === 400);
  ok('admins can still open hidden projects', (await call('gs_project', { p_token: alice.token, p_slug: proj.slug })).status === 200);
  await good('gs_admin_set', { p_token: alice.token, p_project: proj.id, p_field: 'hidden', p_on: false });
  await good('gs_admin_resolve', { p_token: alice.token, p_report: a.reports[0].id });
  ok('report resolved', (await good('gs_admin', { p_token: alice.token })).reports[0].resolved === true);
  await good('gs_admin_set', { p_token: alice.token, p_project: proj.id, p_field: 'featured', p_on: true });

  const [{ id: suid }] = await sql(`insert into users (username, display_name, pw_hash, sample) values ('sample_maker', 'Sample', '!', true) returning id`);
  await sql(`insert into projects (slug, creator_id, title, status, sample, launched_at, deadline) values ('sample-one', $1, 'Sample', 'live', true, now(), now() + interval '9 days')`, [suid]);
  const rm = await good('gs_admin_remove_samples', { p_token: alice.token });
  ok('remove sample projects and users', rm.removed === 1 && (await sql(`select count(*)::int n from users where sample`))[0].n === 0);
});

await block('deleting an account', async () => {
  const z = await good('gs_signup', { p_username: 'zed', p_password: 'zedpassword', p_name: 'Zed' });
  const zp = await launchedProject(z.token, { title: 'Zed live project' });
  const zd = await good('gs_project_new', { p_token: z.token, p_title: 'Zed draft', p_category: 'art' });
  await good('gs_pledge', { p_token: bob.token, p_project: zp.id, p_reward: null, p_amount: 700 });
  const fresh = await launchedProject(alice.token, { title: 'Alice second' });
  await good('gs_pledge', { p_token: z.token, p_project: fresh.id, p_reward: null, p_amount: 900 });
  await bad('needs the password', 'gs_account_delete', { p_token: z.token, p_password: 'x' }, /password/);
  await good('gs_account_delete', { p_token: z.token, p_password: 'zedpassword' });
  const st = await sql(`select status from projects where id = $1`, [zp.id]);
  ok('live project canceled', st[0].status === 'canceled');
  ok('draft removed', (await sql(`select count(*)::int n from projects where id = $1`, [zd.id]))[0].n === 0);
  const fp = await good('gs_project', { p_token: null, p_slug: fresh.slug });
  ok('their pledges are canceled', fp.project.backers === 0);
  const zl = await good('gs_login', { p_username: 'zed', p_password: 'zedpassword' });
  ok('cannot log in afterwards', !!zl.error);
  const u = await sql(`select username, display_name, pw_hash, deleted_at from users where id = $1`, [z.me.id]);
  ok('profile anonymized', u[0].display_name === 'Deleted user' && u[0].pw_hash === '!' && u[0].deleted_at && u[0].username.startsWith('deleted_'));
  ok('username can be reused', (await call('gs_signup', { p_username: 'zed', p_password: 'zedpassword2' })).status === 200);
});

await pool.end(); await su.end();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
