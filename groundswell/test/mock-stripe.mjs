// A small in-memory stand-in for the parts of Stripe (and Resend) that Groundswell uses, so the
// payment and email code can be tested end to end without accounts or network access.
// Stripe: account, accounts, account_links, login_links, customers, checkout sessions (setup mode),
// setup_intents, payment_methods, payment_intents. It also serves fake Checkout and onboarding
// pages that redirect back like the real ones. The card "pm_card_declined" is always declined.
import http from 'http';
import crypto from 'crypto';

// Parses Stripe-style form bodies (a[b][0]=c) into nested objects.
export function parseForm(body) {
  const out = {};
  for (const [k, v] of new URLSearchParams(body)) {
    const path = k.replace(/\]/g, '').split('[');
    let o = out;
    path.forEach((p, i) => {
      if (i === path.length - 1) o[p] = v;
      else o = o[p] = o[p] || (/^\d+$/.test(path[i + 1]) ? [] : {});
    });
  }
  return out;
}

export function startMockStripe(port = 8099) {
  const S = { accounts: {}, customers: {}, sessions: {}, setupIntents: {}, pms: {}, pis: {}, idem: {}, requests: [], emails: [], n: 0 };
  const base = `http://127.0.0.1:${port}`;
  const id = p => `${p}_${++S.n}`;
  const send = (res, status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const err = (res, status, type, message, extra = {}) => send(res, status, { error: { type, message, ...extra } });
  const page = (res, html) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(`<!doctype html><meta name=viewport content="width=device-width"><body style="font-family:sans-serif;padding:24px">${html}</body>`); };
  const redirect = (res, to) => { res.writeHead(303, { Location: to }); res.end(); };
  const sessionView = s => {
    const si = s.setup_intent && S.setupIntents[s.setup_intent];
    return { ...s, setup_intent: si ? { ...si, payment_method: S.pms[si.payment_method] } : null };
  };

  const srv = http.createServer(async (req, res) => {
    const url = new URL(req.url, base);
    const chunks = []; for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString();
    const p = url.pathname, m = req.method;

    // ---- Resend
    if (p === '/emails' && m === 'POST') {
      if (!/^Bearer re_/.test(req.headers.authorization || '')) return send(res, 401, { message: 'bad key' });
      const b = JSON.parse(raw); S.emails.push(b);
      if (String(b.to).includes('bounce')) return send(res, 422, { message: 'invalid recipient' });
      return send(res, 200, { id: id('email') });
    }

    // ---- fake hosted pages
    if (p.startsWith('/checkout/')) {
      const sid = p.split('/')[2], s = S.sessions[sid];
      if (!s) return page(res, 'Session not found');
      if (p.endsWith('/complete')) {
        const pmId = url.searchParams.get('card') === 'declined' ? 'pm_card_declined' : id('pm');
        S.pms[pmId] = { id: pmId, object: 'payment_method', card: { brand: pmId === 'pm_card_declined' ? 'visa' : 'visa', last4: pmId === 'pm_card_declined' ? '0002' : '4242' }, customer: s.customer };
        const si = { id: id('seti'), object: 'setup_intent', status: 'succeeded', payment_method: pmId, customer: s.customer, metadata: s.metadata };
        S.setupIntents[si.id] = si;
        Object.assign(s, { status: 'complete', setup_intent: si.id });
        return redirect(res, s.success_url.replace('{CHECKOUT_SESSION_ID}', s.id));
      }
      return page(res, `<h1>Mock Stripe Checkout</h1><p>${s.custom_text?.submit?.message || ''}</p>
        <p><a id="save-card" href="/checkout/${sid}/complete">Save card 4242</a></p>
        <p><a id="save-declining" href="/checkout/${sid}/complete?card=declined">Save a card that will be declined</a></p>
        <p><a id="cancel" href="${s.cancel_url}">Back</a></p>`);
    }
    if (p.startsWith('/connect/')) {
      const acct = S.accounts[p.split('/')[2]];
      if (!acct) return page(res, 'Account not found');
      if (p.endsWith('/finish')) {
        Object.assign(acct, { details_submitted: true, payouts_enabled: true, capabilities: { transfers: 'active' } });
        return redirect(res, url.searchParams.get('return'));
      }
      return page(res, `<h1>Mock Stripe onboarding</h1><a id="finish" href="/connect/${acct.id}/finish?return=${encodeURIComponent(url.searchParams.get('return'))}">Finish</a>`);
    }
    if (p.startsWith('/express/')) return page(res, '<h1>Mock Express dashboard</h1>');

    // ---- API
    if (!p.startsWith('/v1/')) return send(res, 404, {});
    if (!/^Bearer sk_/.test(req.headers.authorization || '')) return err(res, 401, 'invalid_request_error', 'Invalid API key');
    const body = m === 'POST' ? parseForm(raw) : parseForm(url.search.slice(1));
    S.requests.push({ method: m, path: p, body, headers: req.headers });
    const key = req.headers['idempotency-key'];
    if (key && S.idem[key]) return send(res, S.idem[key].status, S.idem[key].body);
    const reply = (status, obj) => { if (key) S.idem[key] = { status, body: obj }; send(res, status, obj); };
    const parts = p.split('/').slice(2);

    if (m === 'GET' && p === '/v1/account') return send(res, 200, { id: 'acct_platform', country: 'CA' });
    if (m === 'POST' && p === '/v1/accounts') {
      const a = { id: id('acct'), object: 'account', type: body.type, country: body.country, email: body.email, metadata: body.metadata,
        capabilities: { transfers: 'inactive' }, payouts_enabled: false, details_submitted: false };
      S.accounts[a.id] = a; return reply(200, a);
    }
    if (parts[0] === 'accounts' && parts[1]) {
      const a = S.accounts[parts[1]];
      if (!a) return err(res, 404, 'invalid_request_error', 'No such account');
      if (m === 'GET') return send(res, 200, a);
      if (parts[2] === 'login_links') return reply(200, { url: `${base}/express/${a.id}` });
    }
    if (m === 'POST' && p === '/v1/account_links') return reply(200, { url: `${base}/connect/${body.account}?return=${encodeURIComponent(body.return_url)}` });
    if (m === 'POST' && p === '/v1/customers') { const c = { id: id('cus'), ...body }; S.customers[c.id] = c; return reply(200, c); }
    if (m === 'POST' && p === '/v1/checkout/sessions') {
      if (body.mode !== 'setup' || !body.success_url || !body.customer) return err(res, 400, 'invalid_request_error', 'bad session params');
      const s = { id: 'cs_test_' + crypto.randomBytes(6).toString('hex'), object: 'checkout.session', status: 'open', mode: 'setup', ...body, setup_intent: null };
      s.url = `${base}/checkout/${s.id}`; S.sessions[s.id] = s; return reply(200, s);
    }
    if (m === 'GET' && parts[0] === 'checkout' && parts[1] === 'sessions') {
      const s = S.sessions[parts[2]]; return s ? send(res, 200, sessionView(s)) : err(res, 404, 'invalid_request_error', 'No such session');
    }
    if (m === 'GET' && parts[0] === 'setup_intents') { const si = S.setupIntents[parts[1]]; return si ? send(res, 200, { ...si, payment_method: S.pms[si.payment_method] }) : err(res, 404, 'invalid_request_error', 'nope'); }
    if (m === 'GET' && parts[0] === 'payment_methods') { const pm = S.pms[parts[1]]; return pm ? send(res, 200, pm) : err(res, 404, 'invalid_request_error', 'nope'); }
    if (m === 'POST' && p === '/v1/payment_intents') {
      const pi = { id: id('pi'), object: 'payment_intent', amount: +body.amount, currency: body.currency, metadata: body.metadata, customer: body.customer, payment_method: body.payment_method };
      S.pis[pi.id] = pi;
      if (body.payment_method === 'pm_card_declined') {
        pi.status = 'requires_payment_method';
        return reply(402, { error: { type: 'card_error', code: 'card_declined', message: 'Your card was declined.', payment_intent: { id: pi.id } } });
      }
      pi.status = 'succeeded'; return reply(200, pi);
    }
    return err(res, 404, 'invalid_request_error', `Unrecognized request URL (${m} ${p})`);
  });
  return new Promise(r => srv.listen(port, '127.0.0.1', () => r({ base, state: S, close: () => new Promise(c => srv.close(c)) })));
}

// Builds a signed webhook request body + header, as Stripe would send it.
export function signedEvent(secret, type, object, t = Math.floor(Date.now() / 1000)) {
  const body = JSON.stringify({ id: 'evt_' + crypto.randomBytes(5).toString('hex'), type, data: { object } });
  const sig = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return { body, header: `t=${t},v1=${sig}` };
}
