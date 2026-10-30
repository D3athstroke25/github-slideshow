// Helpers for the `gs` Edge Function: database calls as the service role, the Stripe REST API,
// Stripe webhook signatures, and email through Resend. Plain fetch and Web Crypto only, so the
// same code runs on Supabase (Deno) and under Node 22 in the tests.

// deno-lint-ignore no-explicit-any
const G = globalThis as any;
export const env = (k: string, d = ''): string => (G.Deno?.env?.get?.(k) ?? G.process?.env?.[k] ?? '') || d;
export const appUrl = (): string => env('GS_APP_URL', 'https://d3athstroke25.github.io/github-slideshow/groundswell/');

export const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// An error whose message is safe to show to the person using the app.
export class Fail extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

// Calls a gs_svc_* database function with the service role key.
// deno-lint-ignore no-explicit-any
export async function db(name: string, args: Record<string, unknown> = {}): Promise<any> {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const r = await fetch(`${env('SUPABASE_URL')}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!r.ok) throw new Fail((data && data.message) || `Database error ${r.status}`, r.status >= 500 ? 502 : 400);
  return data;
}

// ------------------------------------------------------------ Stripe

export class StripeError extends Error {
  type: string; code: string; status: number; pi: string | null;
  constructor(message: string, type: string, code: string, status: number, pi: string | null) {
    super(message); this.type = type; this.code = code; this.status = status; this.pi = pi;
  }
}

// Stripe's form encoding: nested objects become a[b][c]=v, arrays a[0]=v.
export function form(obj: Record<string, unknown>, prefix = '', out: string[] = []): string {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((x, i) => {
        if (x !== null && typeof x === 'object') form(x as Record<string, unknown>, `${key}[${i}]`, out);
        else out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(x))}`);
      });
    } else if (typeof v === 'object') form(v as Record<string, unknown>, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out.join('&');
}

// deno-lint-ignore no-explicit-any
export async function stripe(method: 'GET' | 'POST', path: string, params: Record<string, unknown> = {}, idempotencyKey?: string): Promise<any> {
  const q = form(params);
  const url = `${env('STRIPE_API_BASE', 'https://api.stripe.com')}/v1/${path}${method === 'GET' && q ? `?${q}` : ''}`;
  const headers: Record<string, string> = { Authorization: `Bearer ${env('STRIPE_SECRET_KEY')}`, 'Stripe-Version': '2024-06-20' };
  if (method === 'POST') headers['Content-Type'] = 'application/x-www-form-urlencoded';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  let r: Response;
  try {
    r = await fetch(url, { method, headers, body: method === 'POST' ? q : undefined });
  } catch (e) {
    throw new StripeError(`Couldn't reach Stripe: ${(e as Error).message}`, 'network', '', 0, null);
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = data.error || {};
    throw new StripeError(e.message || `Stripe error ${r.status}`, e.type || 'api_error', e.code || '', r.status, e.payment_intent?.id ?? null);
  }
  return data;
}

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Checks a Stripe-Signature header (t=...,v1=...) against the raw body, within 5 minutes.
export async function verifyStripe(raw: string, header: string | null, secret: string, nowMs = Date.now()): Promise<boolean> {
  if (!header || !secret) return false;
  let t = 0; const sigs: string[] = [];
  for (const part of header.split(',')) {
    const [k, v] = part.split('=', 2);
    if (k === 't') t = Number(v);
    if (k === 'v1' && v) sigs.push(v);
  }
  if (!t || !sigs.length || Math.abs(nowMs / 1000 - t) > 300) return false;
  const want = await hmacHex(secret, `${t}.${raw}`);
  return sigs.some(s => sameText(s, want));
}

// ------------------------------------------------------------ email

const escapeHtml = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export function money(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase(), minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
  } catch { return `${(cents / 100).toFixed(2)} ${currency}`; }
}

export type Email = { subject: string; text: string; html: string };

// deno-lint-ignore no-explicit-any
export function renderEmail(template: string, data: any): Email {
  const base = appUrl();
  const p = data.project || {};
  const title = p.title || 'a project';
  const link = (path: string) => base + '#' + path;
  let subject = 'Groundswell', lines: string[] = [], cta: [string, string] | null = null, code = '';
  if (template === 'verify') {
    code = data.code;
    subject = `${data.code} is your Groundswell code`;
    lines = ['Enter this code in Groundswell to confirm your email address. It expires in 30 minutes.', 'If you didn’t ask for this, you can ignore this email.'];
  } else if (template === 'reset') {
    code = data.code;
    subject = 'Reset your Groundswell password';
    lines = [`Here is the code to reset the password for @${data.username}. It expires in 30 minutes.`, 'If you didn’t ask for this, ignore this email. Your password stays the same.'];
    cta = ['Reset password', link('/forgot?username=' + encodeURIComponent(data.username || ''))];
  } else {
    const x = data.data || {}, actor = data.actor || 'Someone', slug = p.slug || '';
    const project = link('/p/' + slug);
    switch (data.kind) {
      case 'update': subject = `${title}: Update #${x.n}`; lines = [`${title} posted a new update: “${x.title}”.`]; cta = ['Read the update', link(`/p/${slug}/updates/${x.n}`)]; break;
      case 'funded': subject = `${title} is funded!`; lines = [`${title}, a project you backed, reached its goal. Thank you for helping make it happen.`]; cta = ['See the project', project]; break;
      case 'ended':
        if (x.role === 'creator') {
          subject = x.result === 'successful' ? `${title} was funded!` : `${title} didn’t reach its goal`;
          lines = [x.result === 'successful' ? `Congratulations! Your project ended with ${money(p.pledged || 0, p.currency || 'USD')} pledged.` + (x.payments === 'stripe' ? ' Backers’ cards are being charged now, and the money is paid out to your Stripe account.' : '')
            : 'Your campaign ended without reaching its goal, so no backers were charged. You can start a new campaign whenever you’re ready.'];
        } else {
          subject = x.result === 'successful' ? `${title} was funded` : `${title} didn’t reach its goal`;
          lines = [x.result === 'successful' ? (x.payments === 'stripe' ? 'The campaign reached its goal, so your card will be charged for your pledge shortly.' : 'The campaign reached its goal.')
            : 'The campaign ended without reaching its goal, so you won’t be charged.'];
        }
        cta = ['See the project', project]; break;
      case 'canceled': subject = `${title} was canceled`; lines = ['The creator canceled the campaign, so you won’t be charged.']; cta = ['See the project', project]; break;
      case 'reply': subject = `${actor} replied to your comment`; lines = [`${actor} replied on ${title}: “${x.excerpt}”`]; cta = ['See the conversation', x.n ? link(`/p/${slug}/updates/${x.n}`) : link(`/p/${slug}/comments`)]; break;
      case 'comment': subject = `New comment on ${title}`; lines = [`${actor} commented: “${x.excerpt}”`]; cta = ['Reply', x.n ? link(`/p/${slug}/updates/${x.n}`) : link(`/p/${slug}/comments`)]; break;
      case 'first_backer': subject = `${title} has its first backer!`; lines = [`${actor} just backed ${title}. Congratulations!`]; cta = ['Open your dashboard', project]; break;
      case 'milestone': subject = `${title} is ${x.pct}% funded`; lines = [`Your project just passed ${x.pct}% of its goal.`]; cta = ['See the project', project]; break;
      case 'ending_soon': subject = `${title} ends in less than 48 hours`; lines = ['A project you saved is almost over. Back it before it ends if you’d like to be part of it.']; cta = ['See the project', project]; break;
      case 'survey': subject = `Where should we send your reward from ${title}?`; lines = [`${title} is getting ready to ship. Please enter your shipping address so your reward reaches you.`]; cta = ['Enter your address', project]; break;
      case 'payment_failed': subject = `Action needed: your pledge to ${title}`; lines = [`We couldn’t charge your card for your ${money(x.amount || 0, p.currency || 'USD')} pledge${x.error ? ` (${x.error})` : ''}.`, 'Please update your card within 7 days to keep your pledge and reward.']; cta = ['Update your card', project]; break;
      case 'charged': subject = `Receipt: your pledge to ${title}`; lines = [`Your card was charged ${money(x.amount || 0, p.currency || 'USD')} for your pledge to ${title}. Thank you!`]; cta = ['See the project', project]; break;
      case 'report': subject = `New report: ${x.comment ? 'a comment on ' : ''}${title}`; lines = [`Someone reported ${x.comment ? 'a comment on ' : ''}${title}: “${x.reason || ''}”`, 'Please review it in Moderation.']; cta = ['Open Moderation', link('/admin')]; break;
      default: subject = `News from ${title}`; lines = ['There’s news on a project you follow.']; cta = ['See the project', project];
    }
  }
  const text = [`Hi ${data.name || 'there'},`, '', ...lines, code ? `\n${code}\n` : '', cta ? `${cta[0]}: ${cta[1]}` : '', '', '— Groundswell', `Manage email in Settings: ${link('/settings')}`].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#FAF8F4;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#15181C">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#fff;border:1px solid #E5E1D9;border-radius:14px" cellpadding="0" cellspacing="0"><tr><td style="padding:28px">
<p style="margin:0 0 20px;font-weight:800;font-size:18px;color:#C8401C">groundswell</p>
<p style="margin:0 0 14px;font-size:16px">Hi ${escapeHtml(data.name || 'there')},</p>
${lines.map(l => `<p style="margin:0 0 14px;font-size:16px;line-height:1.5">${escapeHtml(l)}</p>`).join('')}
${code ? `<p style="margin:18px 0;font:700 28px/1.2 ui-monospace,Menlo,monospace;letter-spacing:4px;background:#F3F0EA;border-radius:10px;padding:14px;text-align:center">${escapeHtml(code)}</p>` : ''}
${cta ? `<p style="margin:22px 0 6px"><a href="${escapeHtml(cta[1])}" style="background:#C8401C;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:999px;display:inline-block">${escapeHtml(cta[0])}</a></p>` : ''}
</td></tr></table>
<p style="font-size:12px;color:#646C75;margin:16px 0 0">You get these emails because of activity on Groundswell. <a href="${escapeHtml(link('/settings'))}" style="color:#646C75">Email settings</a></p>
</td></tr></table></body></html>`;
  return { subject, text, html };
}

export async function sendEmail(to: string, m: Email): Promise<void> {
  const r = await fetch(`${env('RESEND_API_BASE', 'https://api.resend.com')}/emails`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env('GS_EMAIL_FROM', 'Groundswell <onboarding@resend.dev>'), to: [to], subject: m.subject, html: m.html, text: m.text }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
}
