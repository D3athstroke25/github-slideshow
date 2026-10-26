// A small stand-in for PostgREST's /rest/v1/rpc endpoint, so tests can call the real SQL
// functions the same way the app does: named JSON arguments, run as `anon` (or as `service_role`, like the Edge Function).
import pg from 'pg';

export function makePool(port = Number(process.env.GS_PG_PORT || 54329)) {
  return new pg.Pool({ host: '127.0.0.1', port, user: 'authenticator', database: 'gs_test', max: 8 });
}

const sigCache = new Map();
async function signature(client, name) {
  if (sigCache.has(name)) return sigCache.get(name);
  const r = await client.query(
    `select p.proargnames as names, array(select format_type(t, null) from unnest(p.proargtypes) t) as types
       from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = $1`, [name]);
  const sig = r.rows[0] ? Object.fromEntries((r.rows[0].names || []).map((n, i) => [n, r.rows[0].types[i]])) : null;
  sigCache.set(name, sig);
  return sig;
}

// Returns { status, body } like PostgREST would.
export async function rpc(pool, name, args = {}, { ip = null, role = 'anon' } = {}) {
  const client = await pool.connect();
  try {
    const sig = await signature(client, name);
    if (!sig) return { status: 404, body: { code: 'PGRST202', message: `Could not find the function public.${name}` } };
    const keys = Object.keys(args);
    for (const k of keys) if (!(k in sig)) return { status: 404, body: { code: 'PGRST202', message: `No ${name}(${k})` } };
    const vals = keys.map(k => {
      const v = args[k];
      if (v === null || v === undefined) return null;
      return /json/.test(sig[k]) ? JSON.stringify(v) : String(v);
    });
    const sql = `select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}::${sig[k]}`).join(', ')}) as r`;
    await client.query('begin');
    await client.query(`set local role ${role === 'service_role' ? 'service_role' : 'anon'}`);
    await client.query(`select set_config('request.headers', $1, true)`, [JSON.stringify(ip ? { 'x-forwarded-for': ip } : {})]);
    const r = await client.query(sql, vals);
    await client.query('commit');
    return { status: 200, body: r.rows[0].r };
  } catch (e) {
    await client.query('rollback').catch(() => {});
    const status = e.code === 'P0001' ? 400 : e.code === '42501' ? 401 : e.code === '42883' ? 404 : 400;
    return { status, body: { code: e.code, message: e.message, details: e.detail ?? null, hint: e.hint ?? null } };
  } finally {
    client.release();
  }
}
