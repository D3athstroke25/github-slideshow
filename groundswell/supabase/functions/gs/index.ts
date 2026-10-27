// Groundswell's server-side function. Deploy with JWT verification off; each route checks its
// own caller.
//   POST /gs/pay      the app: connect a payout account, save a card at Stripe Checkout
//   POST /gs/webhook  Stripe events (signed with STRIPE_WEBHOOK_SECRET)
//   POST /gs/worker   every minute from pg_cron: send queued emails, charge funded pledges
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, RESEND_API_KEY, GS_EMAIL_FROM (optional),
// GS_APP_URL (optional). Without Stripe or Resend keys those parts simply stay off.
import { appUrl, CORS, db, env, Fail, json, money, renderEmail, sendEmail, stripe, StripeError, verifyStripe } from './lib.ts';

export async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const path = new URL(req.url).pathname.replace(/\/+$/, '');
  try {
    if (req.method !== 'POST') return json({ ok: true, service: 'groundswell' });
    if (path.endsWith('/webhook')) return await webhook(req);
    if (path.endsWith('/worker')) return await worker(req);
    if (path.endsWith('/pay')) return await pay(req);
    return json({ message: 'Not found' }, 404);
  } catch (e) {
    if (e instanceof Fail) return json({ message: e.message }, e.status);
    if (e instanceof StripeError) { console.error('stripe', e.type, e.code, e.message); return json({ message: e.message }, 400); }
    console.error(e);
    return json({ message: 'Something went wrong. Please try again.' }, 500);
  }
}

// ------------------------------------------------------------ app: payouts and cards

// Return links go back to the app's return.html, which forwards into the app. Only known bases.
function returnBase(given: unknown): string {
  const allowed = [appUrl(), ...env('GS_EXTRA_RETURN_BASES').split(',').map(s => s.trim()).filter(Boolean)];
  const s = String(given || '');
  return allowed.find(a => s === a) || appUrl();
}
// The iPhone app opens Stripe in an in-app browser; its return page hands control back to the app.
const back = (base: string, to: string, app: boolean, session = false) =>
  `${base}${app ? 'return-app.html' : 'return.html'}?${session ? 'session={CHECKOUT_SESSION_ID}&' : ''}to=${encodeURIComponent(to)}`;

async function pay(req: Request): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  if (!env('STRIPE_SECRET_KEY')) throw new Fail('Payments aren’t set up yet.', 503);
  const user = await db('gs_svc_user', { p_token: body.token ?? null });
  if (!user) throw new Fail('Please log in to continue.', 401);
  const base = returnBase(body.return_base), app = body.app === true;

  if (body.action === 'connect') {
    let acct = user.account;
    if (!acct) {
      const platform = await stripe('GET', 'account');
      const a = await stripe('POST', 'accounts', {
        type: 'express', country: platform.country, email: user.email || undefined,
        capabilities: { transfers: { requested: true } },
        business_profile: { product_description: 'Creative projects funded by backers on Groundswell' },
        metadata: { gs_user: user.id, gs_username: user.username },
      }, `gs-acct-${user.id}`);
      acct = a.id;
      await db('gs_svc_set_account', { p_uid: user.id, p_account: acct, p_ready: false });
    }
    const link = await stripe('POST', 'account_links', {
      account: acct, type: 'account_onboarding',
      refresh_url: back(base, '/settings?stripe=refresh', app), return_url: back(base, '/settings?stripe=done', app),
    });
    return json({ url: link.url });
  }

  if (body.action === 'connect_refresh') {
    if (!user.account) return json({ connected: false, ready: false });
    const a = await stripe('GET', `accounts/${user.account}`);
    const ready = a.capabilities?.transfers === 'active' && a.payouts_enabled === true;
    await db('gs_svc_set_account', { p_uid: user.id, p_account: user.account, p_ready: ready });
    return json({ connected: true, ready, details_submitted: !!a.details_submitted });
  }

  if (body.action === 'dashboard') {
    if (!user.account) throw new Fail('Connect Stripe first.');
    const l = await stripe('POST', `accounts/${user.account}/login_links`);
    return json({ url: l.url });
  }

  if (body.action === 'checkout') {
    const t = await db('gs_svc_checkout_target', { p_uid: user.id, p_intent: body.intent ?? null, p_pledge: body.pledge ?? null });
    if (!t) throw new Fail('This pledge can’t be paid for anymore. Refresh the page and try again.');
    let customer = user.customer;
    if (!customer) {
      const c = await stripe('POST', 'customers', { name: user.name, email: user.email || undefined, metadata: { gs_user: user.id, gs_username: user.username } }, `gs-cus-${user.id}`);
      customer = c.id;
      await db('gs_svc_set_customer', { p_uid: user.id, p_customer: customer });
    }
    const to = t.kind === 'intent' ? `/p/${t.slug}/paid?intent=${t.id}` : `/p/${t.slug}/paid?pledge=${t.id}`;
    const s = await stripe('POST', 'checkout/sessions', {
      mode: 'setup', customer, currency: String(t.currency).toLowerCase(), payment_method_types: ['card'],
      success_url: back(base, to, app, true), cancel_url: back(base, `/p/${t.slug}`, app),
      metadata: { gs_kind: t.kind, gs_id: t.id, gs_user: user.id },
      setup_intent_data: { metadata: { gs_kind: t.kind, gs_id: t.id, gs_user: user.id } },
      custom_text: { submit: { message: `Your card is saved now and charged ${money(t.amount, t.currency)} only if ${t.title} reaches its goal.` } },
    });
    if (t.kind === 'intent') await db('gs_svc_intent_session', { p_intent: t.id, p_session: s.id });
    return json({ url: s.url });
  }

  if (body.action === 'confirm') {
    let sid: string | null = body.session || null;
    if (!sid && body.intent) {
      const t = await db('gs_svc_checkout_target', { p_uid: user.id, p_intent: body.intent, p_pledge: null });
      if (!t) return json({ done: true });
      sid = t.session;
    }
    if (!sid || !/^cs_[A-Za-z0-9_]+$/.test(sid)) throw new Fail('That checkout wasn’t found.');
    const s = await stripe('GET', `checkout/sessions/${sid}`, { expand: ['setup_intent.payment_method'] });
    if (s.metadata?.gs_user !== user.id) throw new Fail('That checkout belongs to another account.', 403);
    return json(await completeSession(s));
  }

  throw new Fail('Unknown action.');
}

// A finished setup-mode Checkout: turn the intent into a pledge, or put the new card on a pledge.
// deno-lint-ignore no-explicit-any
async function completeSession(s: any): Promise<any> {
  if (s.mode !== 'setup' || s.status !== 'complete') return { done: false, status: s.status };
  let si = s.setup_intent;
  if (typeof si === 'string') si = await stripe('GET', `setup_intents/${si}`, { expand: ['payment_method'] });
  let pm = si && si.payment_method;
  if (typeof pm === 'string') pm = await stripe('GET', `payment_methods/${pm}`);
  if (!pm || !pm.id) throw new Fail('No card was saved.');
  const card = pm.card || {};
  if (s.metadata?.gs_kind === 'intent') {
    const r = await db('gs_svc_intent_complete', { p_intent: s.metadata.gs_id, p_customer: s.customer, p_pm: pm.id, p_brand: card.brand ?? null, p_last4: card.last4 ?? null });
    return { done: true, kind: 'intent', ...r };
  }
  const p = await db('gs_svc_card_update', { p_pledge: s.metadata?.gs_id, p_pm: pm.id, p_brand: card.brand ?? null, p_last4: card.last4 ?? null });
  return { done: true, kind: 'fix', pledge: p };
}

// ------------------------------------------------------------ Stripe webhook

async function webhook(req: Request): Promise<Response> {
  const raw = await req.text();
  if (!(await verifyStripe(raw, req.headers.get('stripe-signature'), env('STRIPE_WEBHOOK_SECRET')))) throw new Fail('Invalid signature.', 400);
  const evt = JSON.parse(raw);
  const o = evt.data?.object || {};
  try {
    if (evt.type === 'checkout.session.completed' && o.mode === 'setup' && o.metadata?.gs_kind) await completeSession(o);
    else if (evt.type === 'account.updated') await db('gs_svc_account_ready', { p_account: o.id, p_ready: o.capabilities?.transfers === 'active' && o.payouts_enabled === true });
    else if (evt.type === 'payment_intent.succeeded' && o.metadata?.gs_pledge) await db('gs_svc_charge_done', { p_pledge: o.metadata.gs_pledge, p_result: 'paid', p_pi: o.id, p_error: null });
    else if (evt.type === 'payment_intent.payment_failed' && o.metadata?.gs_pledge) await db('gs_svc_charge_done', { p_pledge: o.metadata.gs_pledge, p_result: 'failed', p_pi: o.id, p_error: o.last_payment_error?.message ?? 'The payment failed.' });
  } catch (e) {
    // Business errors (a project that already ended, an intent already used) won't change on retry.
    if (e instanceof Fail && e.status === 400) { console.warn('webhook', evt.type, e.message); return json({ received: true, note: e.message }); }
    throw e;
  }
  return json({ received: true });
}

// ------------------------------------------------------------ worker

async function worker(req: Request): Promise<Response> {
  if (!(await db('gs_svc_worker_ok', { p_secret: req.headers.get('x-worker-secret') }))) throw new Fail('Not allowed.', 401);
  const hasEmail = !!env('RESEND_API_KEY'), hasStripe = !!env('STRIPE_SECRET_KEY');
  const out = { emails: 0, email_errors: 0, charges: 0, charge_failures: 0, charge_retries: 0 };
  await db('gs_svc_tick', { p_email: hasEmail, p_stripe: hasStripe });
  if (hasEmail) {
    for (const m of await db('gs_svc_emails_claim', { p_limit: 40 })) {
      try {
        await sendEmail(m.to, renderEmail(m.template, m.data));
        await db('gs_svc_email_done', { p_id: m.id, p_ok: true, p_error: null });
        out.emails++;
      } catch (e) {
        await db('gs_svc_email_done', { p_id: m.id, p_ok: false, p_error: (e as Error).message });
        out.email_errors++;
      }
    }
  }
  if (hasStripe) {
    for (const c of await db('gs_svc_charges_claim', { p_limit: 20 })) {
      const r = await charge(c);
      if (r === 'paid') out.charges++; else if (r === 'failed') out.charge_failures++; else out.charge_retries++;
    }
  }
  return json(out);
}

// Charges one pledge: a destination charge on the backer's saved card, paid out to the creator's
// connected account minus the platform fee. The idempotency key (pledge + card) means a retry can
// never charge twice.
// deno-lint-ignore no-explicit-any
async function charge(c: any): Promise<'paid' | 'failed' | 'retry' | 'pending'> {
  const done = (result: string, pi: string | null, error: string | null) => db('gs_svc_charge_done', { p_pledge: c.pledge, p_result: result, p_pi: pi, p_error: error });
  if (!c.customer || !c.pm) { await done('failed', null, 'No card on file.'); return 'failed'; }
  if (!c.destination) { await done('retry', null, 'The creator’s payout account isn’t connected.'); return 'retry'; }
  try {
    const pi = await stripe('POST', 'payment_intents', {
      amount: c.amount, currency: c.currency, customer: c.customer, payment_method: c.pm,
      off_session: true, confirm: true, application_fee_amount: c.fee, transfer_data: { destination: c.destination },
      description: `Pledge to ${c.title} (backer #${c.backer_no})`, metadata: { gs_pledge: c.pledge, gs_project: c.slug },
    }, `gs-charge-${c.pledge}-${c.pm}`);
    if (pi.status === 'succeeded') { await done('paid', pi.id, null); return 'paid'; }
    if (pi.status === 'processing') return 'pending'; // finished by the payment_intent webhook
    await done('failed', pi.id, pi.status === 'requires_action' ? 'Your bank asked for extra verification. Please update your card to confirm it.' : 'The card was declined.');
    return 'failed';
  } catch (e) {
    if (e instanceof StripeError && (e.type === 'card_error' || e.status === 402)) { await done('failed', e.pi, e.message); return 'failed'; }
    await done('retry', null, (e as Error).message);
    return 'retry';
  }
}

// deno-lint-ignore no-explicit-any
const D = (globalThis as any).Deno;
if (D?.serve) D.serve(handle);
