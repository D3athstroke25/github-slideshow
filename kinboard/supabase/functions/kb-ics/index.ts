// Fetches a family's calendar subscription (Google / iCloud / Outlook "secret iCal address")
// on behalf of the Kinboard app, which cannot fetch those URLs directly from a browser (CORS).
// Only callers holding a valid family code may use it, so it is not an open proxy.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'apikey, content-type, authorization, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const MAX_BYTES = 3_000_000;

function reply(status: number, body: unknown, type = 'application/json') {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': type } });
}

function safeUrl(raw: string): URL | null {
  let s = String(raw || '').trim();
  if (/^webcals?:\/\//i.test(s)) s = s.replace(/^webcals?:/i, 'https:');
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const h = u.hostname.toLowerCase();
  if (!h.includes('.') || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localhost')) return null;
  if (/^[\d.]+$/.test(h) || h.includes(':') || h.startsWith('[')) return null; // no raw IPs
  if (u.username || u.password) return null;
  if (u.port && u.port !== '443') return null;
  return u;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'method_not_allowed' });
  let body: { code?: string; url?: string };
  try { body = await req.json(); } catch { return reply(400, { error: 'bad_json' }); }

  // 1. The caller must hold a real family code.
  const apikey = req.headers.get('apikey') || Deno.env.get('SUPABASE_ANON_KEY') || '';
  const check = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/kb_check`, {
    method: 'POST', headers: { apikey, 'Content-Type': 'application/json' }, body: JSON.stringify({ code: body.code || '' }),
  });
  if (!check.ok) return reply(403, { error: 'family_not_found' });

  // 2. Fetch the calendar, following at most 3 redirects, each re-checked.
  let url = safeUrl(body.url || '');
  if (!url) return reply(400, { error: 'bad_url' });
  let res: Response | null = null;
  for (let hop = 0; hop < 4; hop++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      res = await fetch(url, { redirect: 'manual', signal: ctrl.signal, headers: { 'User-Agent': 'Kinboard calendar sync', Accept: 'text/calendar, text/plain, */*' } });
    } catch { clearTimeout(timer); return reply(502, { error: 'fetch_failed' }); }
    clearTimeout(timer);
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = safeUrl(new URL(res.headers.get('location')!, url).toString());
      if (!url) return reply(400, { error: 'bad_redirect' });
      continue;
    }
    break;
  }
  if (!res || !res.ok) return reply(502, { error: 'calendar_http_' + (res ? res.status : 0) });

  // 3. Read at most MAX_BYTES and make sure it is really a calendar.
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) { reader.cancel(); return reply(413, { error: 'calendar_too_large' }); }
    chunks.push(value);
  }
  const buf = new Uint8Array(size); let o = 0; for (const c of chunks) { buf.set(c, o); o += c.length; }
  const text = new TextDecoder().decode(buf);
  if (!text.includes('BEGIN:VCALENDAR')) return reply(422, { error: 'not_a_calendar' });
  return reply(200, text, 'text/calendar; charset=utf-8');
});
