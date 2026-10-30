// Groundswell web app. Plain JavaScript, no build step. Hash routes (#/p/slug, #/edit/id/basics, ...)
// so it works from any static host. All data comes from the gs_* database functions.
'use strict';
(() => {
const CFG = window.GS_CONFIG || {};
const NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const PLUG = (window.Capacitor && window.Capacitor.Plugins) || {};
// Server settings (gs_config): the payment mode for new launches, and which services are on.
let CONF = { payments: 'test', email: false, stripe: false, fee_bps: 800 };
const testSite = () => CONF.payments !== 'stripe';
const isTest = p => (p && p.payments ? p.payments : CONF.payments) !== 'stripe';
const MEDIA = `${CFG.url}/storage/v1/object/public/media/`;
const CATS = [['art', 'Art'], ['comics', 'Comics'], ['crafts', 'Crafts'], ['dance', 'Dance'], ['design', 'Design'],
  ['fashion', 'Fashion'], ['film', 'Film & Video'], ['food', 'Food'], ['games', 'Games'], ['journalism', 'Journalism'],
  ['music', 'Music'], ['photography', 'Photography'], ['publishing', 'Publishing'], ['technology', 'Technology'], ['theater', 'Theater']];
const CAT = Object.fromEntries(CATS);
const CURRENCIES = [['USD', 'US dollar'], ['CAD', 'Canadian dollar'], ['EUR', 'Euro'], ['GBP', 'British pound'], ['AUD', 'Australian dollar']];
const SORTS = [['magic', 'Trending'], ['newest', 'Newest'], ['ending', 'Ending soon'], ['funded', 'Most funded'], ['backers', 'Most backed']];
const STATES = [['live', 'Live now'], ['successful', 'Funded'], ['all', 'All projects']];

// ------------------------------------------------------------ small utilities
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* private mode */ } },
};
let skew = 0; // server clock minus device clock, so countdowns agree with the deadline the server enforces
const now = () => Date.now() + skew;
const setSkew = iso => { const t = Date.parse(iso); if (t) skew = t - Date.now(); };
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const plural = (n, one, many = one + 's') => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const pctOf = c => c.goal ? Math.floor((c.pledged / c.goal) * 100) : 0;

function money(cents, cur = 'USD', { compact = false } = {}) {
  const v = (cents || 0) / 100, frac = cents % 100 ? 2 : 0;
  const o = { style: 'currency', currency: cur, minimumFractionDigits: frac, maximumFractionDigits: frac };
  if (compact && v >= 100000) Object.assign(o, { notation: 'compact', minimumFractionDigits: 0, maximumFractionDigits: 1 });
  try { return new Intl.NumberFormat(undefined, o).format(v); } catch { return `${cur} ${v.toFixed(frac)}`; }
}
function curSymbol(cur) {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).formatToParts(0).find(p => p.type === 'currency').value; } catch { return cur; }
}
function toCents(s) {
  const t = String(s ?? '').replace(/[\s,]/g, '').replace(/[^0-9.]/g, '');
  if (!t || !/^\d*\.?\d*$/.test(t)) return null;
  const v = Math.round(parseFloat(t) * 100);
  return Number.isFinite(v) ? v : null;
}
const units = cents => cents == null ? '' : (cents % 100 ? (cents / 100).toFixed(2) : String(cents / 100));
const fmtDate = (iso, o = { month: 'short', day: 'numeric', year: 'numeric' }) => iso ? new Date(iso).toLocaleDateString(undefined, o) : '';
const fmtDateTime = iso => iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
const fmtMonth = ym => ym ? new Date(ym + '-15').toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : '';
function ago(iso) {
  const s = Math.max(0, (now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(iso);
}
function timeLeft(deadline) {
  const ms = Date.parse(deadline) - now();
  if (ms <= 0) return { n: 0, unit: 'hours' };
  const d = ms / 864e5, h = ms / 36e5;
  if (d >= 2) return { n: Math.floor(d), unit: 'days' };
  if (h >= 1) return { n: Math.floor(h), unit: Math.floor(h) === 1 ? 'hour' : 'hours' };
  return { n: Math.max(1, Math.floor(ms / 6e4)), unit: 'minutes' };
}
function hue(s) { let h = 0; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; }
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ------------------------------------------------------------ icons and art
const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  bell: '<path d="M6 16v-5a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  share: '<path d="M12 3v13"/><path d="m7 8 5-5 5 5"/><path d="M5 13v8h14v-8"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  chevL: '<path d="m15 5-7 7 7 7"/>', chevR: '<path d="m9 5 7 7-7 7"/>', chevD: '<path d="m5 9 7 7 7-7"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 14h10l1-14"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 17-5-5-9 8"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  bold: '<path d="M7 4h6a4 4 0 0 1 0 8H7z"/><path d="M7 12h7a4 4 0 0 1 0 8H7z"/>',
  italic: '<path d="M10 4h8M6 20h8M15 4 9 20"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
  quote: '<path d="M4 7h5v5H6.5L5 16"/><path d="M14 7h5v5h-2.5L15 16"/>',
  heading: '<path d="M6 4v16M18 4v16M6 12h12"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.5-5 6.5-5s5.5 1.5 6.5 5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 15c2 .7 3 2.2 3.5 5"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
  settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  logout: '<path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h10"/>',
  upload: '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 20h16"/>',
  download: '<path d="M12 4v12"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  gift: '<rect x="3" y="8" width="18" height="5" rx="1"/><path d="M5 13v8h14v-8M12 8v13"/><path d="M12 8c-1-3-3.5-4.5-5-3.5S6.5 8 12 8c5.5 0 6.5-2.5 5-3.5S13 5 12 8"/>',
  truck: '<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  message: '<path d="M4 5h16v11H9l-5 4z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  rocket: '<path d="M5 15c-1 1-1.5 4-1.5 4s3-.5 4-1.5"/><path d="M9 15l-3-3c1.5-4 5-8.5 12-9-.5 7-5 10.5-9 12z"/><circle cx="14.5" cy="9.5" r="1.5"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>', down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  heart: '<path d="M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.5A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v6H4V6h6"/>',
  wave: '<path d="M2 15c3 0 3.5-4 7-4s4 4 7 4 4-6 6-6"/>',
};
const icon = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;
const LOGO = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="var(--accent)"/><g fill="none" stroke="var(--accent-ink)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 23c3.2 0 4.3-3.6 7.5-3.6S15 23 18.2 23s4.6-3.6 7.8-3.6"/><path d="M7 16.5c3.2 0 4.3-3.6 7.5-3.6s3.5 3.6 6.7 3.6S25.8 9 28 9"/></g></svg>';

// Generated cover art for projects without an uploaded image: layered shapes from a seed.
const PALETTES = [
  ['#F4E1C1', '#E8502E', '#2F5D62', '#F2A541'], ['#DCE8F2', '#2F4B7C', '#F28F3B', '#88B2CC'],
  ['#EFE6F5', '#6D4C9F', '#E86A92', '#C3A6E0'], ['#E3F0E3', '#2E7D5B', '#F2C14E', '#8CC3A0'],
  ['#FBE3D6', '#C8401C', '#2B2D42', '#F7A072'], ['#E6ECEF', '#1F3B4D', '#E2B33C', '#7FA7B5'],
  ['#F7EBD6', '#8C5E2A', '#D94F30', '#E9C46A'], ['#E5F2F1', '#0F766E', '#F97352', '#99D5CF'],
  ['#F1E7E7', '#7A2E3A', '#E0A458', '#C98B92'], ['#ECEFE3', '#4D5B23', '#D96C3B', '#B5C27A'],
];
function art(seed = 0, cat = '') {
  seed = Math.abs(seed | 0);
  const r = mulberry32(seed * 7919 + cat.length), pal = PALETTES[seed % PALETTES.length], kind = Math.floor(seed / 10) % 4;
  let s = `<rect width="160" height="90" fill="${pal[0]}"/>`;
  if (kind === 0) {
    s += `<circle cx="${(105 + r() * 35).toFixed(1)}" cy="${(16 + r() * 12).toFixed(1)}" r="${(9 + r() * 7).toFixed(1)}" fill="${pal[3]}"/>`;
    for (let i = 0; i < 4; i++) {
      const y = 38 + i * 13 + r() * 6, a = 5 + r() * 9; let d = `M0 ${y.toFixed(1)}`;
      for (let x = 0; x < 160; x += 20) d += ` Q${x + 10} ${(y + ((x / 20) % 2 ? a : -a)).toFixed(1)} ${x + 20} ${y.toFixed(1)}`;
      s += `<path d="${d} V90 H0Z" fill="${pal[1 + (i % 3)]}" opacity="${(0.55 + i * 0.13).toFixed(2)}"/>`;
    }
  } else if (kind === 1) {
    for (let i = 0; i < 7; i++) s += `<circle cx="${(r() * 160).toFixed(1)}" cy="${(r() * 90).toFixed(1)}" r="${(8 + r() * 30).toFixed(1)}" fill="${pal[1 + (i % 3)]}" opacity="${(0.5 + r() * 0.45).toFixed(2)}"/>`;
  } else if (kind === 2) {
    s += `<g transform="rotate(${(-25 + r() * 50).toFixed(1)} 80 45)">`;
    let x = -60;
    for (let i = 0; x < 220; i++) { const w = 10 + r() * 26; s += `<rect x="${x.toFixed(1)}" y="-60" width="${w.toFixed(1)}" height="210" fill="${pal[1 + (i % 3)]}" opacity="${i % 2 ? 0.9 : 0.55}"/>`; x += w + 6 + r() * 14; }
    s += '</g>';
  } else {
    for (let j = 0; j < 3; j++) {
      const cx = 20 + r() * 120, base = 92;
      for (let k = 4; k > 0; k--) s += `<circle cx="${cx.toFixed(1)}" cy="${base}" r="${(k * (8 + j * 3)).toFixed(1)}" fill="${pal[1 + ((k + j) % 3)]}" opacity="0.9"/>`;
    }
  }
  return `<svg viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${s}</svg>`;
}
const coverInner = (c, eager) => c.cover
  ? `<img src="${esc(MEDIA + c.cover)}" alt="" ${eager ? '' : 'loading="lazy"'} decoding="async" data-seed="${c.seed | 0}" data-cat="${esc(c.category)}">`
  : art(c.seed, c.category);
const cover = (c, eager = false) => `<div class="cover">${coverInner(c, eager)}</div>`;
document.addEventListener('error', e => {
  const t = e.target;
  if (t.tagName === 'IMG' && t.dataset.seed !== undefined && t.parentNode) t.outerHTML = art(+t.dataset.seed, t.dataset.cat || '');
}, true);

function avatar(u, size = 40) {
  const st = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px`;
  if (u && u.avatar) return `<img class="avatar" src="${esc(MEDIA + u.avatar)}" alt="" style="${st}" loading="lazy">`;
  const name = (u && u.name) || '?', init = name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  return `<span class="avatar" style="${st};background:hsl(${hue(u && (u.username || u.name))} 45% 42%)" aria-hidden="true">${esc(init)}</span>`;
}

// ------------------------------------------------------------ markdown (escaped first, small safe subset)
function safeUrl(u) { return /^(https?:\/\/|mailto:)/i.test(u) ? u : null; }
function figure(url, alt) {
  if (!url.startsWith(esc(MEDIA))) return `<p><a href="${url}" target="_blank" rel="noopener nofollow ugc">${alt || 'Image'}</a></p>`;
  return `<figure><img src="${url}" alt="${alt}" loading="lazy">${alt ? `<figcaption>${alt}</figcaption>` : ''}</figure>`;
}
function inline(t) {
  let s = esc(t); const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, txt, url) => { const u = safeUrl(url); return u ? `<a href="${u}" target="_blank" rel="noopener nofollow ugc">${txt}</a>` : txt; });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\s](?:[^*]*[^*\s])?)\*(?![*\w])/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^\w])_([^_\s](?:[^_]*[^_\s])?)_(?!\w)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}
function md(src) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  let out = '', para = [], list = null, quote = [];
  const fP = () => { if (para.length) out += `<p>${para.map(inline).join('<br>')}</p>`; para = []; };
  const fL = () => { if (list) out += `<${list.t}>${list.items.map(i => `<li>${inline(i)}</li>`).join('')}</${list.t}>`; list = null; };
  const fQ = () => { if (quote.length) out += `<blockquote>${quote.map(inline).join('<br>')}</blockquote>`; quote = []; };
  const all = () => { fP(); fL(); fQ(); };
  for (const raw of lines) {
    const line = raw.trimEnd(); let m;
    if (!line.trim()) { all(); continue; }
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) { all(); const l = m[1].length + 1; out += `<h${l}>${inline(m[2])}</h${l}>`; continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { all(); out += '<hr>'; continue; }
    if ((m = line.match(/^\s*!\[([^\]]*)\]\(([^)\s]+)\)\s*$/))) { all(); out += figure(esc(m[2]), esc(m[1])); continue; }
    if ((m = line.match(/^>\s?(.*)$/))) { fP(); fL(); quote.push(m[1]); continue; }
    if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) { fP(); fQ(); if (!list || list.t !== 'ul') { fL(); list = { t: 'ul', items: [] }; } list.items.push(m[1]); continue; }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { fP(); fQ(); if (!list || list.t !== 'ol') { fL(); list = { t: 'ol', items: [] }; } list.items.push(m[1]); continue; }
    if (list && /^\s{2,}/.test(raw)) { list.items[list.items.length - 1] += ' ' + line.trim(); continue; }
    fL(); fQ(); para.push(line);
  }
  all();
  return out;
}
const plain = s => String(s || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[#>*_`-]+/g, ' ').replace(/\s+/g, ' ').trim();
function videoEmbed(url) {
  let m;
  if ((m = String(url).match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,20})/))) return `https://www.youtube-nocookie.com/embed/${m[1]}?rel=0`;
  if ((m = String(url).match(/vimeo\.com\/(?:video\/)?(\d{5,12})/))) return `https://player.vimeo.com/video/${m[1]}`;
  return null;
}

// ------------------------------------------------------------ session and API
const S = { token: store.get('gs.token'), me: store.get('gs.me'), unread: 0 };
function setSession(token, me) { S.token = token; S.me = me; store.set('gs.token', token); store.set('gs.me', me); PCACHE.clear(); renderChrome(); }
function setMe(me) { S.me = me; store.set('gs.me', me); renderChrome(); }
function signOutLocal() { S.token = null; S.me = null; S.unread = 0; store.del('gs.token'); store.del('gs.me'); PCACHE.clear(); renderChrome(); }
const apiHeaders = (extra = {}) => Object.assign({ apikey: CFG.key }, /^eyJ/.test(CFG.key || '') ? { Authorization: `Bearer ${CFG.key}` } : {}, extra);

// Calls a gs_* function. Arguments are given without the p_ prefix; the session token is added.
async function rpc(name, args = {}, { auth = true } = {}) {
  const body = {};
  for (const [k, v] of Object.entries(args)) body['p_' + k] = v === undefined ? null : v;
  if (auth) body.p_token = S.token || null;
  let r;
  try {
    r = await fetch(`${CFG.url}/rest/v1/rpc/${name}`, { method: 'POST', headers: apiHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
  } catch {
    throw Object.assign(new Error('Can’t reach Groundswell. Check your connection and try again.'), { offline: true });
  }
  const text = await r.text(); let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!r.ok) {
    const err = new Error((data && data.message) || `Something went wrong (${r.status}). Please try again.`);
    err.hint = data && data.hint; err.status = r.status;
    if (err.hint === 'auth' && S.token) signOutLocal();
    throw err;
  }
  if (data && data.now) setSkew(data.now);
  return data;
}

// Resizes an image on the device, then uploads it to the ticketed Storage path. Returns the path.
async function uploadImage(file, kind) {
  if (!file || !/^image\//.test(file.type)) throw new Error('Choose a JPEG, PNG or WebP image.');
  const blob = await shrink(file, kind);
  const { path } = await rpc('gs_upload_ticket', { kind });
  let r;
  try {
    r = await fetch(`${CFG.url}/storage/v1/object/media/${path}`, { method: 'POST', headers: apiHeaders({ 'Content-Type': 'image/jpeg', 'x-upsert': 'false', 'cache-control': 'max-age=31536000' }), body: blob });
  } catch { throw new Error('Upload failed. Check your connection and try again.'); }
  if (!r.ok) { let m = ''; try { m = (await r.json()).message; } catch { /* ignore */ } throw new Error('Upload failed' + (m ? `: ${m}` : '.')); }
  return path;
}
async function shrink(file, kind) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That image couldn’t be read. Try a JPEG or PNG.')); i.src = url; });
    let sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0, W, H;
    if (kind === 'cover') { const want = 16 / 9; if (sw / sh > want) { const nw = sh * want; sx = (sw - nw) / 2; sw = nw; } else { const nh = sw / want; sy = (sh - nh) / 2; sh = nh; } W = Math.min(1600, sw); H = Math.round(W / want); }
    else if (kind === 'avatar') { const m = Math.min(sw, sh); sx = (sw - m) / 2; sy = (sh - m) / 2; sw = sh = m; W = H = Math.min(400, m); }
    else { W = Math.min(1600, sw); H = Math.round(sh * (W / sw)); }
    const c = document.createElement('canvas'); c.width = Math.round(W); c.height = Math.round(H);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('Couldn’t prepare that image.')), 'image/jpeg', 0.85));
  } finally { URL.revokeObjectURL(url); }
}

// ------------------------------------------------------------ UI helpers
function toast(msg, kind = '') {
  const t = document.createElement('div'); t.className = 'toast ' + kind; t.setAttribute('role', kind === 'bad' ? 'alert' : 'status');
  t.innerHTML = (kind === 'bad' ? icon('alert') : icon('check')) + `<span>${esc(msg)}</span>`;
  $('#toasts').append(t); setTimeout(() => t.remove(), kind === 'bad' ? 6000 : 3200);
}
async function busy(btn, fn) {
  if (btn && btn.classList.contains('busy')) return;
  btn && btn.classList.add('busy');
  try { return await fn(); } catch (e) { toast(e.message, 'bad'); } finally { btn && btn.classList.remove('busy'); }
}
function formErr(form, msg) {
  let el = $('.err', form);
  if (!msg) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('div'); el.className = 'err'; el.setAttribute('role', 'alert'); form.prepend(el); }
  el.textContent = msg;
}
async function submitting(form, fn) {
  const btn = $('[type=submit]', form);
  if (btn && btn.classList.contains('busy')) return;
  formErr(form, null); btn && btn.classList.add('busy');
  try { await fn(); } catch (e) { formErr(form, e.message); } finally { btn && btn.classList.remove('busy'); }
}
function modal(html, { onClose } = {}) {
  const back = document.createElement('div'); back.className = 'modal-back';
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  const prev = document.activeElement;
  const close = () => { back.remove(); document.removeEventListener('keydown', key); onClose && onClose(); prev && prev.focus && prev.focus(); };
  const key = e => { if (e.key === 'Escape') close(); };
  back.addEventListener('click', e => { if (e.target === back || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', key);
  document.body.append(back);
  const f = $('input,textarea,select,button:not([data-close])', back); f && f.focus();
  return { el: $('.modal', back), close };
}
function confirmBox(title, body, { ok = 'Confirm', danger = false } = {}) {
  return new Promise(res => {
    let done = false;
    const m = modal(`<h2>${esc(title)}</h2><p class="muted">${body}</p><div class="acts"><button class="btn ghost" data-close>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(ok)}</button></div>`,
      { onClose: () => { if (!done) res(false); } });
    $('[data-yes]', m.el).addEventListener('click', () => { done = true; m.close(); res(true); });
  });
}
async function copyText(t, msg = 'Link copied') {
  try { await navigator.clipboard.writeText(t); toast(msg); }
  catch { modal(`<h2>Copy this</h2><input class="input" readonly value="${esc(t)}" onfocus="this.select()"><div class="acts"><button class="btn primary" data-close>Done</button></div>`); }
}
async function share(title, url) {
  if (NATIVE && PLUG.Share) { try { await PLUG.Share.share({ title, url }); } catch { /* dismissed */ } return; }
  if (navigator.share) { try { await navigator.share({ title, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
  copyText(url);
}
const projectUrl = slug => `${CFG.appUrl || location.href.split('#')[0]}#/p/${slug}`;
const setMain = html => { $('#main').innerHTML = html; };
const needLogin = next => go('/login?next=' + encodeURIComponent(next || currentPath()));

// ------------------------------------------------------------ shared pieces
function bar(c) { const p = Math.min(100, pctOf(c)); return `<div class="bar ${c.status === 'successful' ? 'good' : ''}" role="img" aria-label="${pctOf(c)}% funded"><i style="width:${p}%"></i></div>`; }
function statusShort(c) {
  if (c.status === 'live') { const t = timeLeft(c.deadline); return `<span><b>${t.n}</b> ${t.unit} left</span>`; }
  if (c.status === 'successful') return `<span class="good">${icon('check', 'sm')} Funded</span>`;
  if (c.status === 'unsuccessful') return '<span>Unsuccessful</span>';
  if (c.status === 'canceled') return '<span>Canceled</span>';
  return '<span>Draft</span>';
}
function saveBtn(c, cls = 'savebtn') {
  return `<button class="${cls}" data-act="save" data-id="${c.id}" aria-pressed="${!!c.saved}" aria-label="${c.saved ? 'Saved' : 'Save'}: ${esc(c.title)}" title="${c.saved ? 'Saved' : 'Remind me'}">${icon('bookmark')}</button>`;
}
function card(c, { href } = {}) {
  return `<article class="card">
    ${cover(c)}
    <div class="badges">${c.sample ? '<span class="tag">Sample</span>' : ''}${c.status === 'draft' ? '<span class="tag">Draft</span>' : ''}${c.hidden ? '<span class="tag">Hidden</span>' : ''}</div>
    ${c.status !== 'draft' ? saveBtn(c) : ''}
    <a class="title-link" href="${href || '#/p/' + c.slug}"><h3>${esc(c.title || 'Untitled project')}</h3></a>
    <div class="by">by ${esc(c.creator && c.creator.name)}</div>
    <p class="blurb">${esc(c.blurb)}</p>
    <div class="meta">
      ${bar(c)}
      <div class="stats"><span><b>${money(c.pledged, c.currency, { compact: true })}</b> pledged</span><span><b>${pctOf(c)}%</b></span>${statusShort(c)}</div>
      <div class="meta-tags"><span>${esc(CAT[c.category] || '')}</span>${c.location ? `<span>${icon('pin', 'sm')}${esc(c.location)}</span>` : ''}</div>
    </div>
  </article>`;
}
const cards = (list, opt) => `<div class="cards">${list.map(c => card(c, opt)).join('')}</div>`;
const skelCards = (n = 8) => `<div class="cards">${Array.from({ length: n }, () => '<div><div class="skel" style="aspect-ratio:16/9"></div><div class="skel" style="height:20px;margin-top:12px;width:80%"></div><div class="skel" style="height:14px;margin-top:8px;width:50%"></div></div>').join('')}</div>`;
const loading = () => `<div class="wrap page">${skelCards(4)}</div>`;
function errorPage(e, retry = true) {
  const nf = e && e.hint === 'notfound';
  return `<div class="wrap page"><div class="empty"><h3>${nf ? 'Not found' : 'Something went wrong'}</h3><p>${esc(e && e.message || 'Please try again.')}</p>
    <div class="row" style="justify-content:center">${retry && !nf ? '<button class="btn primary" data-act="retry">Try again</button>' : ''}<a class="btn ghost" href="#/">Go home</a></div></div></div>`;
}
const testNotice = p => isTest(p) ? `<div class="notice warn">${icon('info')}<div><b>Test mode.</b> Pledges are recorded and count toward the goal, but no card is taken and no money moves.</div></div>`
  : `<div class="notice">${icon('lock')}<div><b>Secure payment by Stripe.</b> You save a card on Stripe\u2019s page. It\u2019s charged only if this project reaches its goal.</div></div>`;
const cap = s => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
const cardText = c => c ? `${cap(c.brand || 'card')} ending in ${c.last4 || '\u2022\u2022\u2022\u2022'}` : '';
// The gs Edge Function (payments). Adds the session token and where Stripe should send people back.
async function gsFn(route, body) {
  let r;
  try {
    r = await fetch(`${CFG.url}/functions/v1/gs/${route}`, { method: 'POST', headers: apiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ token: S.token, return_base: CFG.appUrl, app: NATIVE, ...body }) });
  } catch { throw new Error('Can\u2019t reach Groundswell. Check your connection and try again.'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.message || `Something went wrong (${r.status}). Please try again.`);
  return data;
}
// Stripe pages open in the in-app browser on iPhone, and in this tab on the web.
async function openOut(url) { if (NATIVE && PLUG.Browser) await PLUG.Browser.open({ url }); else location.href = url; }
async function startCheckout(args, slug) {
  const r = await gsFn('pay', { action: 'checkout', ...args });
  store.set('gs.paying', { ...args, slug, at: Date.now() });
  await openOut(r.url);
}

// ------------------------------------------------------------ chrome: header, tab bar, footer
function renderChrome() {
  const r = parseHash(), p0 = r.parts[0] || '';
  const cur = (...names) => names.includes(p0) ? 'aria-current="page"' : '';
  const u = S.me;
  const set = (sel, html) => { const el = $(sel); if (el._html !== html) { el.innerHTML = html; el._html = html; } };
  set('#top', `
    <a class="logo" href="#/" aria-label="Groundswell home">${LOGO}<span>groundswell</span></a>
    <nav class="nav" aria-label="Main"><a href="#/explore" ${cur('explore')}>Discover</a><a href="#/start" ${cur('start', 'edit')}>Start a project</a></nav>
    <span class="spacer"></span>
    <form class="top-search" data-form="search" role="search">${icon('search')}<input name="q" type="search" placeholder="Search projects" aria-label="Search projects" value="${p0 === 'explore' ? esc(r.q.q || '') : ''}"></form>
    <a class="iconbtn m-only" href="#/explore?focus=1" aria-label="Search">${icon('search')}</a>
    ${u ? `<a class="iconbtn" href="#/activity" aria-label="Activity${S.unread ? `, ${S.unread} unread` : ''}">${icon('bell')}${S.unread ? `<span class="dot-badge">${S.unread > 9 ? '9+' : S.unread}</span>` : ''}</a>
      <div class="menu"><button class="iconbtn" data-act="menu" aria-haspopup="true" aria-expanded="false" aria-label="Account menu">${avatar(u, 32)}</button></div>`
      : `<div class="auth"><a class="btn quiet sm" href="#/login">Log in</a><a class="btn dark sm d-only" href="#/signup">Sign up</a></div>`}`);
  set('#tabbar', `
    <a href="#/" ${cur('')}>${icon('home')}Home</a>
    <a href="#/explore" ${cur('explore')}>${icon('compass')}Explore</a>
    <a href="#/start" class="start" ${cur('start', 'edit')}>${icon('plus')}Start</a>
    <a href="#/activity" ${cur('activity')}>${icon('bell')}Activity${S.unread ? `<span class="dot-badge">${S.unread > 9 ? '9+' : S.unread}</span>` : ''}</a>
    <a href="#/me" ${cur('me', 'settings', 'u', 'login', 'signup')}>${u ? avatar(u, 22) : icon('user')}${u ? 'You' : 'Log in'}</a>`);
  set('#foot', `<div class="wrap"><div class="row"><span class="logo" style="font-size:17px">${LOGO}groundswell</span>${testSite() ? `<span class="testmode">${icon('info', 'sm')} Test mode: no real money moves</span>` : ''}</div>
    <nav aria-label="Footer"><a href="#/how">How it works</a><a href="#/explore">Discover</a><a href="#/start">Start a project</a><a href="support.html">Help & contact</a><a href="privacy.html">Privacy</a><a href="terms.html">Terms</a></nav></div>`);
}
function openMenu(btn) {
  const wrap = btn.parentNode; const old = $('.menu-pop', wrap);
  if (old) { old.remove(); btn.setAttribute('aria-expanded', 'false'); return; }
  const u = S.me; const pop = document.createElement('div'); pop.className = 'menu-pop'; pop.setAttribute('role', 'menu');
  pop.innerHTML = `<div class="menu-head"><b>${esc(u.name)}</b><span class="muted small">@${esc(u.username)}</span></div>
    <a href="#/u/${esc(u.username)}" role="menuitem">${icon('user')}Profile</a>
    <a href="#/me" role="menuitem">${icon('heart')}Backed & saved</a>
    <a href="#/me/created" role="menuitem">${icon('rocket')}My projects</a>
    <a href="#/settings" role="menuitem">${icon('settings')}Settings</a>
    ${u.admin ? `<a href="#/admin" role="menuitem">${icon('flag')}Moderation</a>` : ''}
    <a href="support.html" role="menuitem">${icon('info')}Help & contact</a>
    <hr><button data-act="logout" role="menuitem">${icon('logout')}Log out</button>`;
  wrap.append(pop); btn.setAttribute('aria-expanded', 'true');
  setTimeout(() => document.addEventListener('click', function off(e) { if (!pop.contains(e.target) || e.target.closest('a,button')) { pop.remove(); btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('click', off); } }), 0);
}

// ------------------------------------------------------------ router
let routeId = 0;
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, ''), i = raw.indexOf('?');
  const path = i < 0 ? raw : raw.slice(0, i), qs = i < 0 ? '' : raw.slice(i + 1);
  let parts; try { parts = path.split('/').filter(Boolean).map(decodeURIComponent); } catch { parts = []; }
  return { parts, q: Object.fromEntries(new URLSearchParams(qs)) };
}
const currentPath = () => location.hash.replace(/^#/, '') || '/';
const go = path => { if (location.hash === '#' + path) route(); else location.hash = '#' + path; };
let lastKey = '';
async function route() {
  const r = parseHash(), id = ++routeId, ctx = { ...r, id, stale: () => id !== routeId };
  const key = r.parts[0] === 'p' && !['pledge', 'thanks'].includes(r.parts[2]) ? 'p/' + r.parts[1] : r.parts.join('/') + '?' + Math.random();
  const samePage = key === lastKey;
  lastKey = key;
  if (ED && !(r.parts[0] === 'edit' && r.parts[1] === ED.p.id)) { flushSave(); ED = null; }
  stopPoll();
  renderChrome();
  if (!samePage) window.scrollTo(0, 0);
  const page = PAGES[r.parts[0] || ''] || pageNotFound;
  try { await page(ctx); }
  catch (e) { if (!ctx.stale()) { setMain(errorPage(e)); if (e.hint === 'auth') needLogin(); } }
  if (!ctx.stale() && !samePage) { const h = $('#main h1'); document.title = h ? `${h.textContent.trim()} · Groundswell` : 'Groundswell'; }
}
function pageNotFound() { setMain(errorPage({ hint: 'notfound', message: 'That page doesn’t exist.' })); }

// ------------------------------------------------------------ home
async function pageHome(ctx) {
  setMain(loading());
  const d = await rpc('gs_home');
  if (ctx.stale()) return;
  const sec = (title, list, sort, extra = '') => list && list.length ? `<section class="section"><div class="section-head"><h2>${title}</h2><a href="#/explore?${sort}">See all</a></div><div class="rowscroll">${list.map(c => card(c)).join('')}</div>${extra}</section>` : '';
  const f = d.featured;
  const anyLive = d.stats.live > 0;
  setMain(`<div class="wrap">
    <section class="hero"><div class="hero-grid">
      <div>
        <h1>Back the things you want <em>to exist.</em></h1>
        <p class="lede">Groundswell is where creators bring new projects to life with the support of people like you. Every project is all-or-nothing: creators are only funded if they reach their goal.</p>
        <div class="ctas"><a class="btn primary lg" href="#/explore">Explore projects</a><a class="btn ghost lg" href="#/start">Start a project</a></div>
        <div class="statline"><div><b>${d.stats.live.toLocaleString()}</b><span>projects live now</span></div><div><b>${d.stats.funded.toLocaleString()}</b><span>projects funded</span></div><div><b>${d.stats.backers.toLocaleString()}</b><span>backers</span></div></div>
      </div>
      ${f ? `<article class="feature card"><div style="position:relative">${cover(f, true)}<div class="badges">${f.sample ? '<span class="tag">Sample</span>' : ''}</div>${saveBtn(f)}</div>
        <div class="body"><p class="eyebrow">Featured project</p><a class="title-link" href="#/p/${f.slug}"><h3>${esc(f.title)}</h3></a>
        <div class="by">by ${esc(f.creator.name)}</div><p class="blurb">${esc(f.blurb)}</p>${bar(f)}
        <div class="stats"><span><b>${money(f.pledged, f.currency)}</b> pledged</span><span><b>${pctOf(f)}%</b> funded</span>${statusShort(f)}</div></div></article>`
      : `<div class="feature"><div class="cover">${art(7, 'design')}</div><div class="body"><p class="eyebrow">Be the first</p><h3>No projects are live yet</h3><p class="blurb">Start one and it will be featured here.</p><a class="btn primary" href="#/start">Start a project</a></div></div>`}
    </div></section>
    <section class="section"><div class="chips" role="list">${CATS.map(([k, v]) => `<a class="chip" role="listitem" href="#/explore?cat=${k}">${esc(v)}${d.categories[k] ? ` <span class="muted">${d.categories[k]}</span>` : ''}</a>`).join('')}</div></section>
    ${sec('Trending', d.trending, 'sort=magic')}
    ${sec('Nearly funded', d.nearly, 'sort=funded')}
    ${sec('Ending soon', d.ending, 'sort=ending')}
    ${sec('Just launched', d.fresh, 'sort=newest')}
    ${sec('Recently funded', d.funded, 'state=successful&sort=newest')}
    ${!anyLive && !d.funded.length ? '' : ''}
    <section class="section"><div class="section-head"><h2>How Groundswell works</h2><a href="#/how">Learn more</a></div>
      <div class="how">
        <div class="step"><span class="n">1</span><h3>Creators set a goal</h3><p>Every project has a funding goal and a deadline of up to 60 days, plus rewards for the people who back it.</p></div>
        <div class="step"><span class="n">2</span><h3>Backers pledge</h3><p>Pick a reward or pledge any amount. You can change or cancel your pledge until the campaign ends.</p></div>
        <div class="step"><span class="n">3</span><h3>All or nothing</h3><p>If the goal is met by the deadline, pledges are collected and the creator gets to work. If not, no one pays.</p></div>
      </div></section>
  </div>`);
}

// ------------------------------------------------------------ explore
async function pageExplore(ctx) {
  const q = { q: ctx.q.q || '', cat: ctx.q.cat || '', state: ctx.q.state || 'live', sort: ctx.q.sort || 'magic' };
  const qs = o => '#/explore?' + new URLSearchParams(Object.entries({ ...q, ...o }).filter(([k, v]) => v && !(k === 'state' && v === 'live') && !(k === 'sort' && v === 'magic'))).toString();
  const title = q.q ? `Results for “${esc(q.q)}”` : q.cat ? esc(CAT[q.cat] || 'Projects') : 'Discover projects';
  setMain(`<div class="wrap page">
    <h1 class="page-title">${title}</h1>
    <form class="filters" data-form="explore" role="search">
      <label class="search"><span class="sr">Search</span>${icon('search')}<input class="input" name="q" type="search" placeholder="Search by title, creator or place" value="${esc(q.q)}"></label>
      <label><span class="sr">Show</span><select class="select" name="state">${STATES.map(([k, v]) => `<option value="${k}" ${k === q.state ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label><span class="sr">Sort by</span><select class="select" name="sort">${SORTS.map(([k, v]) => `<option value="${k}" ${k === q.sort ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <input type="hidden" name="cat" value="${esc(q.cat)}">
    </form>
    <div class="chips"><a class="chip ${!q.cat ? 'on' : ''}" href="${qs({ cat: '' })}">All categories</a>${CATS.map(([k, v]) => `<a class="chip ${q.cat === k ? 'on' : ''}" href="${qs({ cat: k })}">${esc(v)}</a>`).join('')}</div>
    <div id="results">${skelCards(8)}</div></div>`);
  if (ctx.q.focus) $('.filters input[name=q]').focus();
  const load = async (offset, into) => {
    const d = await rpc('gs_explore', { q: q.q, category: q.cat, state: q.state === 'all' ? 'all' : q.state, sort: q.sort, offset });
    if (ctx.stale()) return;
    if (!into) {
      $('#results').innerHTML = d.total ? `<p class="resultline">${plural(d.total, 'project')}</p><div class="cards" id="grid"></div><div id="more" style="text-align:center;margin-top:28px"></div>`
        : `<div class="empty"><h3>No projects found</h3><p>${q.q ? 'Try a different search, or ' : ''}browse another category.</p><a class="btn ghost" href="#/explore">Clear filters</a></div>`;
      if (!d.total) return;
    }
    $('#grid').insertAdjacentHTML('beforeend', d.items.map(c => card(c)).join(''));
    $('#more').innerHTML = d.more ? `<button class="btn ghost" data-act="more" data-offset="${offset + d.items.length}">Show more</button>` : '';
  };
  EXPLORE_MORE = (btn) => busy(btn, () => load(+btn.dataset.offset, true));
  await load(0, false);
}
let EXPLORE_MORE = null;

// ------------------------------------------------------------ project page
const PCACHE = new Map();
let POLL = null;
const stopPoll = () => { if (POLL) clearInterval(POLL); POLL = null; };
async function getProject(slug, preview, fresh = false) {
  const hit = PCACHE.get(slug);
  if (!fresh && hit && Date.now() - hit.at < 30000) return hit.d;
  const d = await rpc('gs_project', { slug, preview: preview || null });
  PCACHE.set(slug, { d, at: Date.now() });
  return d;
}
// What became of my pledge, in words.
function pledgeOutcome(pl, p) {
  if (pl.status === 'dropped') return 'Your pledge was not collected.';
  if (pl.status !== 'collected') return '';
  if (p.payments !== 'stripe') return 'Pledge collected (test mode, no money moved).';
  return { paid: `Charged to your ${cardText(pl.card)}.`, due: 'Your card will be charged shortly.', processing: 'Your card is being charged.',
    failed: 'Your card was declined.', abandoned: 'The payment failed, so the pledge was dropped.' }[pl.charge_status] || 'Your pledge was collected.';
}
function payAlerts(d) {
  const p = d.project, pl = d.me.pledge, a = d.me.address;
  let out = '';
  if (pl && pl.charge_status === 'failed') out += `<div class="notice warn" style="margin-bottom:12px">${icon('alert')}<div><b>Your payment didn’t go through.</b> ${esc(pl.charge_error || '')} Update your card by ${fmtDate(pl.fix_by)} to keep your pledge.<div style="margin-top:10px"><button class="btn primary sm" data-act="fix-card" data-pledge="${pl.id}" data-slug="${p.slug}">Update card</button></div></div></div>`;
  if (d.me.needs_address) out += `<div class="notice accent" style="margin-bottom:12px">${icon('truck')}<div><b>Where should your reward go?</b> The creator is getting ready to ship.<div style="margin-top:10px"><button class="btn primary sm" data-act="address" data-id="${p.id}" data-slug="${p.slug}">Enter shipping address</button></div></div></div>`;
  else if (a) out += `<div class="mine"><span class="muted small">Shipping to</span><b>${esc(a.name)}</b><span class="small muted">${esc([a.line1, a.city, a.region, a.country].filter(Boolean).join(', '))} · <button class="linkbtn small" data-act="address" data-id="${p.id}" data-slug="${p.slug}">Edit</button></span></div>`;
  return out;
}
function statsPanel(d) {
  const p = d.project, me = d.me, live = p.status === 'live';
  const t = live ? timeLeft(p.deadline) : null;
  const shareRow = `<div class="actions">${saveBtnWide(p)}<button class="btn ghost" data-act="share" data-slug="${p.slug}" data-title="${esc(p.title)}">${icon('share')}Share</button></div>`;
  let action = '';
  if (me.creator) {
    action = `<div class="actions"><a class="btn dark" href="#/edit/${p.id}/basics">${icon('edit')}Edit project</a>${p.status !== 'draft' ? `<a class="btn ghost" href="#/dash/${p.id}">${icon('chart')}Dashboard</a>` : ''}</div>`;
  } else if (live) {
    const pl = me.pledge && me.pledge.status === 'active' ? me.pledge : null;
    action = (pl ? `<div class="mine"><span class="muted small">You're backer #${pl.backer_no}</span><b>${money(pl.amount, p.currency)} pledged${pl.reward ? ` · ${esc(pl.reward)}` : ''}</b>${pl.card ? `<span class="small muted">${icon('lock', 'sm')} ${esc(cardText(pl.card))} · <button class="linkbtn small" data-act="fix-card" data-pledge="${pl.id}" data-slug="${p.slug}">Change card</button></span>` : ''}</div>
        <a class="btn ghost block lg" href="#/p/${p.slug}/pledge">Manage your pledge</a>`
      : `<a class="btn primary block lg" href="#/p/${p.slug}/pledge" data-act="back">Back this project</a>`) + shareRow;
  } else if (p.status === 'draft') {
    action = '<div class="result bad"><b>Not launched yet</b>This is a draft preview.</div>';
  }
  if (!live && p.status !== 'draft') {
    const pl = me.pledge;
    const res = p.status === 'successful'
      ? `<div class="result good"><b>${icon('check')} Funded</b>This project was successfully funded on ${fmtDate(p.ended_at)}.</div>`
      : p.status === 'canceled' ? `<div class="result bad"><b>Canceled</b>The creator canceled this campaign on ${fmtDate(p.ended_at)}. No one was charged.</div>`
        : `<div class="result bad"><b>Funding unsuccessful</b>This project didn’t reach its goal by ${fmtDate(p.ended_at)}. No one was charged.</div>`;
    const mine = pl && pl.status !== 'canceled' ? `<div class="mine"><span class="muted small">You were backer #${pl.backer_no}</span><b>${money(pl.amount, p.currency)}${pl.reward ? ` · ${esc(pl.reward)}` : ''}</b><span class="small muted">${esc(pledgeOutcome(pl, p))}</span></div>` : '';
    action = res + mine + (me.creator ? action : shareRow);
  }
  return `${bar(p)}
    <div class="big">${money(p.pledged, p.currency)}</div>
    <div class="of">pledged of ${money(p.goal, p.currency)} goal</div>
    <div class="kv"><div><b>${p.backers.toLocaleString()}</b><span>${p.backers === 1 ? 'backer' : 'backers'}</span></div>
      ${live ? `<div><b>${t.n}</b><span>${t.unit} to go</span></div>` : `<div><b>${pctOf(p)}%</b><span>funded</span></div>`}</div>
    ${payAlerts(d)}${action}
    ${live ? `<p class="aon"><b>All or nothing.</b> This project will only be funded if it reaches its goal by ${fmtDateTime(p.deadline)}.${p.payments === 'stripe' ? ' Cards are charged only then.' : ''}</p>` : ''}`;
}
const saveBtnWide = p => `<button class="btn ghost" data-act="save" data-id="${p.id}" aria-pressed="${!!p.saved}">${icon('bookmark')}${p.saved ? 'Saved' : 'Remind me'}</button>`;
function rewardCard(r, p, { link = true } = {}) {
  const soldOut = r.limit !== null && r.left === 0;
  const tagName = link && p.status === 'live' && !soldOut ? 'a' : 'div';
  return `<${tagName} class="reward ${soldOut ? 'soldout' : ''}" ${tagName === 'a' ? `href="#/p/${p.slug}/pledge?reward=${r.id}"` : ''}>
    <div class="amt">Pledge ${money(r.amount, p.currency)} or more</div>
    <h3>${esc(r.title)}</h3>
    ${r.description ? `<p class="desc">${esc(r.description)}</p>` : ''}
    ${r.items.length ? `<ul>${r.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
    <div class="facts">
      ${r.est_delivery ? `<div><span>Estimated delivery</span><b>${fmtMonth(r.est_delivery)}</b></div>` : ''}
      <div><span>Ships</span><b>${r.ships ? (r.shipping ? `Worldwide, +${money(r.shipping, p.currency)}` : 'Worldwide, free') : 'No shipping'}</b></div>
      <div><span>Backers</span><b>${r.backers.toLocaleString()}</b></div>
      ${r.limit !== null ? `<div><span>Limited</span><b>${soldOut ? 'All gone' : `${r.left} of ${r.limit} left`}</b></div>` : ''}
    </div>
    ${tagName === 'a' ? `<span class="btn primary block pick">Select this reward</span>` : ''}
  </${tagName}>`;
}
async function pageProject(ctx) {
  const [, slug, tab = 'campaign', sub] = ctx.parts;
  if (tab === 'pledge') return pagePledge(ctx, slug);
  if (tab === 'thanks') return pageThanks(ctx, slug);
  if (tab === 'paid') return pagePaid(ctx, slug);
  const cached = PCACHE.get(slug);
  if (!cached) setMain(`<div class="wrap page"><div class="skel" style="height:48px;max-width:560px;margin:20px auto"></div><div class="p-top"><div class="skel" style="aspect-ratio:16/9"></div><div class="skel" style="height:280px"></div></div></div>`);
  const d = await getProject(slug, ctx.q.preview);
  if (ctx.stale()) return;
  renderProject(ctx, d, tab, sub);
  if (d.project.status === 'live') {
    POLL = setInterval(async () => {
      if (document.hidden) return;
      try { const n = await getProject(slug, ctx.q.preview, true); if (ctx.stale()) return stopPoll(); const el = $('#pstats'); if (el) el.innerHTML = statsPanel(n); } catch { /* keep the last view */ }
    }, 20000);
  }
}
function renderProject(ctx, d, tab, sub) {
  const p = d.project, me = d.me, base = `#/p/${p.slug}`;
  const pv = ctx.q.preview ? `?preview=${encodeURIComponent(ctx.q.preview)}` : '';
  const tabs = [['campaign', 'Campaign'], ['rewards', 'Rewards', d.rewards.length], ['faq', 'FAQ', p.faqs.length], ['updates', 'Updates', d.updates.length], ['comments', 'Comments', p.comments], ['community', 'Community']];
  const embed = p.video && videoEmbed(p.video);
  const banner = [
    p.sample ? `<div class="notice">${icon('sparkle')}<div><b>Sample project.</b> It shows how Groundswell works. You can try backing it; it’s a test pledge.</div></div>` : '',
    p.status === 'draft' ? `<div class="notice accent">${icon('eye')}<div><b>Draft preview.</b> Only you${me.creator ? ' and people you share the preview link with' : ''} can see this page.${me.creator ? ` <button class="linkbtn" data-act="copy-preview" data-url="${esc(projectUrl(p.slug) + '?preview=' + p.preview_key)}">Copy preview link</button>` : ''}</div></div>` : '',
    p.hidden ? `<div class="notice warn">${icon('lock')}<div><b>Hidden by moderators.</b> Only the creator and moderators can see this project.</div></div>` : '',
  ].filter(Boolean).join('');
  let body = '';
  if (tab === 'campaign') {
    body = `<div class="p-body two"><div>
        <section class="story-section"><h2 class="sec">Story</h2><div class="prose">${md(p.story) || '<p class="muted">The creator hasn’t written their story yet.</p>'}</div></section>
        ${p.risks ? `<section class="story-section"><h2 class="sec">Risks and challenges</h2><div class="prose">${md(p.risks)}</div></section>` : ''}
        ${me.signed_in && !me.creator && p.status !== 'draft' ? `<p style="margin-top:36px"><button class="linkbtn small" data-act="report" data-id="${p.id}">${icon('flag', 'sm')} Report this project</button></p>` : ''}
      </div><aside class="side-sticky">${creatorCard(d)}<h2 style="font-size:20px;margin:26px 0 12px">Rewards</h2>${rewardsList(d)}</aside></div>`;
  } else if (tab === 'rewards') {
    body = `<div class="p-body narrow">${rewardsList(d)}</div>`;
  } else if (tab === 'faq') {
    body = `<div class="p-body narrow">${p.faqs.length ? p.faqs.map(f => `<details class="panel"><summary style="font-weight:700;cursor:pointer">${esc(f.q)}</summary><div class="prose" style="margin-top:10px">${md(f.a)}</div></details>`).join('') : '<div class="empty"><h3>No questions yet</h3><p>Ask the creator in the comments.</p></div>'}</div>`;
  } else if (tab === 'updates' && sub) {
    const u = d.updates.find(x => String(x.n) === sub);
    body = u ? `<div class="p-body narrow"><a href="${base}/updates${pv}" class="small muted">${icon('chevL', 'sm')} All updates</a>
        <article style="margin-top:14px"><span class="tag">Update #${u.n}</span>${u.backers_only ? ` <span class="tag accent">${icon('lock', 'sm')} Backers only</span>` : ''}
        <h1 style="font-size:32px;margin:12px 0 6px">${esc(u.title)}</h1><p class="muted small">${fmtDate(u.created_at)}${u.edited_at ? ' · edited' : ''}</p>
        <div class="prose" style="margin-top:20px">${u.body === null ? lockedUpdate(d) : md(u.body)}</div></article>
        <section style="margin-top:40px"><h2 style="font-size:22px;margin-bottom:16px">Comments</h2><div id="thread" data-update="${u.id}"><div class="skel" style="height:80px"></div></div></section></div>`
      : '<div class="p-body narrow"><div class="empty"><h3>That update was removed</h3></div></div>';
  } else if (tab === 'updates') {
    body = `<div class="p-body narrow">${me.creator && p.status !== 'draft' ? `<a class="btn dark" href="#/dash/${p.id}?tab=updates" style="margin-bottom:16px">${icon('plus')}Post an update</a>` : ''}
      ${d.updates.length ? d.updates.map(u => `<a class="update-item" href="${base}/updates/${u.n}${pv}"><span class="tag">Update #${u.n}</span>${u.backers_only ? ` <span class="tag accent">${icon('lock', 'sm')} Backers only</span>` : ''}
        <h3>${esc(u.title)}</h3><p>${u.body === null ? 'This update is for backers only.' : esc(plain(u.body).slice(0, 280))}</p><div class="small muted" style="margin-top:8px">${fmtDate(u.created_at)} · ${plural(u.comments, 'comment')}</div></a>`).join('')
      : '<div class="empty"><h3>No updates yet</h3><p>Back this project to hear about progress as it happens.</p></div>'}</div>`;
  } else if (tab === 'comments') {
    body = `<div class="p-body narrow"><div id="thread" data-update=""><div class="skel" style="height:80px"></div></div></div>`;
  } else if (tab === 'community') {
    const c = d.community, ret = c.returning, fresh = Math.max(0, c.backers - ret);
    body = `<div class="p-body narrow">${c.backers ? `<div class="panel"><h2>${plural(c.backers, 'backer')} so far</h2>
      <div class="hbars">
        <div class="hbar"><div class="t"><span>New to Groundswell</span><span class="num">${fresh.toLocaleString()}</span></div><div class="track"><i style="width:${(fresh / c.backers) * 100}%"></i></div></div>
        <div class="hbar"><div class="t"><span>Have backed other projects</span><span class="num">${ret.toLocaleString()}</span></div><div class="track"><i style="width:${(ret / c.backers) * 100}%"></i></div></div>
      </div></div>` : '<div class="empty"><h3>No backers yet</h3><p>Be the first to back this project.</p></div>'}</div>`;
  }
  const showCta = p.status === 'live' && !me.creator;
  const pl = me.pledge && me.pledge.status === 'active';
  setMain(`<div class="wrap ${showCta ? 'has-mobile-cta' : ''}">
    ${banner ? `<div class="p-banner" style="display:grid;gap:10px">${banner}</div>` : ''}
    <header class="p-head"><h1>${esc(p.title)}</h1><p class="blurb">${esc(p.blurb)}</p></header>
    <div class="p-top">
      <div><div class="p-media">${embed ? `<iframe src="${esc(embed)}" title="Project video" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe>` : cover(p, true)}</div>
        <div class="p-tags"><a href="#/explore?cat=${p.category}">${esc(CAT[p.category] || p.category)}</a>${p.location ? `<span>${icon('pin', 'sm')} ${esc(p.location)}</span>` : ''}<span>by <a href="${p.creator.username ? '#/u/' + esc(p.creator.username) : '#/'}">${esc(p.creator.name)}</a></span></div></div>
      <div class="p-stats" id="pstats">${statsPanel(d)}</div>
    </div>
    <nav class="tabs p-tabs" aria-label="Project sections">${tabs.map(([k, v, n]) => `<a href="${base}${k === 'campaign' ? '' : '/' + k}${pv}" ${k === tab ? 'aria-current="page"' : ''}>${v}${n ? `<span class="count">${n}</span>` : ''}</a>`).join('')}</nav>
    ${body}
    ${showCta ? `<div class="mobile-cta"><a class="btn ${pl ? 'ghost' : 'primary'} block lg" href="#/p/${p.slug}/pledge">${pl ? 'Manage your pledge' : 'Back this project'}</a></div>` : ''}
  </div>`);
  const th = $('#thread');
  if (th) loadThread(d, th.dataset.update || null);
}
function lockedUpdate(d) {
  return `<div class="notice accent">${icon('lock')}<div><b>For backers only.</b> ${d.project.status === 'live' ? `<a href="#/p/${d.project.slug}/pledge">Back this project</a> to read it.` : 'Only people who backed this project can read it.'}</div></div>`;
}
function creatorCard(d) {
  const c = d.creator;
  return `<div class="panel creator-card">${avatar(c, 56)}<div><h3>${c.username ? `<a href="#/u/${esc(c.username)}" style="text-decoration:none">${esc(c.name)}</a>` : esc(c.name)}</h3>
    <div class="muted">${c.created !== undefined ? `${plural(c.created, 'project')} created · ${c.backed} backed` : ''}${c.location ? `<br>${esc(c.location)}` : ''}</div>
    ${c.bio ? `<p class="small" style="margin-top:8px;color:var(--ink-2);white-space:pre-line">${esc(c.bio)}</p>` : ''}</div></div>`;
}
function rewardsList(d) {
  const p = d.project;
  return `<div class="rewards">
    ${p.status === 'live' && !d.me.creator ? `<a class="reward" href="#/p/${p.slug}/pledge?reward=none"><div class="amt">Pledge without a reward</div><p class="desc">Back it because you believe in it. Any amount from ${money(100, p.currency)}.</p></a>` : ''}
    ${d.rewards.map(r => rewardCard(r, p, { link: !d.me.creator })).join('') || '<p class="muted">No rewards yet.</p>'}</div>`;
}
async function loadThread(d, updateId) {
  const el = $('#thread'); if (!el) return;
  let t;
  try { t = await rpc('gs_comments', { project: d.project.id, update: updateId }); } catch (e) { el.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  if (!document.body.contains(el)) return;
  // Replies from people you blocked are left out; their top-level comments stay as a placeholder if others replied.
  const kids = {}; for (const c of t.items) if (c.parent && !c.blocked) (kids[c.parent] = kids[c.parent] || []).push(c);
  const gone = c => c.deleted || c.blocked;
  const one = c => `<div class="comment" id="c-${c.id}">${gone(c) ? '<span class="avatar" style="width:40px;height:40px"></span>' : avatar(c.author, 40)}<div class="body">
      <div class="who">${gone(c) ? `<span class="muted">${c.deleted ? 'Comment removed' : 'Hidden because you blocked this person'}</span>` : `${c.author.username ? `<a href="#/u/${esc(c.author.username)}">${esc(c.author.name)}</a>` : `<b>${esc(c.author.name)}</b>`}${c.badge === 'creator' ? ' <span class="tag accent">Creator</span>' : c.badge === 'backer' ? ' <span class="tag">Backer</span>' : ''}`}<span class="muted small">${ago(c.created_at)}</span></div>
      ${gone(c) ? '' : `<div class="text">${esc(c.body)}</div>`}
      <div class="tools">${t.can_comment && !gone(c) && !c.parent ? `<button data-act="reply" data-id="${c.id}">Reply</button>` : ''}${c.can_delete ? `<button data-act="del-comment" data-id="${c.id}">Delete</button>` : ''}${S.me && !c.mine && !gone(c) ? `<button data-act="report-comment" data-id="${c.id}">Report</button>${c.author.username ? `<button data-act="block" data-username="${esc(c.author.username)}" data-name="${esc(c.author.name)}">Block</button>` : ''}` : ''}</div>
      ${!c.parent && (kids[c.id] || []).length ? `<div class="replies">${kids[c.id].map(one).join('')}</div>` : ''}
      <div class="reply-slot"></div></div></div>`;
  const tops = t.items.filter(c => !c.parent && !(gone(c) && !(kids[c.id] || []).length)).reverse();
  let composer;
  if (t.locked) composer = lockedUpdate(d);
  else if (t.can_comment) composer = `<form class="composer" data-form="comment" data-project="${d.project.id}" data-update="${updateId || ''}"><label class="sr" for="cbody">Comment</label><textarea id="cbody" class="textarea" name="body" maxlength="2000" placeholder="Say something nice, ask a question…" required></textarea><div><button class="btn primary" type="submit">Post comment</button></div></form>`;
  else if (!S.me) composer = `<div class="notice">${icon('message')}<div>Only backers can post comments. <a href="#/login?next=${encodeURIComponent(currentPath())}">Log in</a> if you’ve backed this project.</div></div>`;
  else composer = `<div class="notice">${icon('message')}<div>Only backers can post comments.${d.project.status === 'live' ? ` <a href="#/p/${d.project.slug}/pledge">Back this project</a> to join the conversation.` : ''}</div></div>`;
  el.innerHTML = `${composer}<div style="height:18px"></div><div class="comments">${tops.length ? tops.map(one).join('') : '<p class="muted">No comments yet.</p>'}</div>`;
  el._ctx = { d, updateId };
}

// ------------------------------------------------------------ pledge flow
let PL = null, THANKS = null;
async function pagePledge(ctx, slug) {
  if (!S.token) return needLogin(`/p/${slug}/pledge${ctx.q.reward ? '?reward=' + ctx.q.reward : ''}`);
  setMain(loading());
  const d = await getProject(slug, null, true);
  if (ctx.stale()) return;
  const p = d.project;
  if (d.me.creator) { setMain(errorPage({ message: 'You can’t back your own project.', hint: 'notfound' }, false)); return; }
  if (p.status !== 'live') { setMain(errorPage({ message: 'This campaign has ended, so it’s no longer taking pledges.', hint: 'notfound' }, false)); return; }
  const mine = d.me.pledge && d.me.pledge.status === 'active' ? d.me.pledge : null;
  let sel = ctx.q.reward || (mine ? (mine.reward_id || 'none') : null);
  if (sel && sel !== 'none' && !d.rewards.some(r => r.id === sel)) sel = null;
  const base = id => { const r = d.rewards.find(x => x.id === id); return r ? r.amount + (r.ships ? r.shipping : 0) : 100; };
  PL = { d, sel, step: 'pick', mine, extra: {} };
  if (mine) PL.extra[mine.reward_id || 'none'] = mine.reward_id ? Math.max(0, mine.amount - base(mine.reward_id)) : mine.amount;
  renderPledge();
}
function plTotal() {
  const { d, sel, extra } = PL;
  if (sel === 'none') return extra.none ?? 100;
  const r = d.rewards.find(x => x.id === sel); if (!r) return 0;
  return r.amount + (r.ships ? r.shipping : 0) + (extra[sel] || 0);
}
function renderPledge() {
  const { d, sel, step, mine } = PL, p = d.project, cur = p.currency;
  const head = `<div class="pl-head">${cover(p)}<div><p class="muted small">${mine ? 'Changing your pledge to' : 'You\u2019re backing'}</p><h1>${esc(p.title)}</h1></div></div>`;
  if (step === 'review') {
    const r = d.rewards.find(x => x.id === sel), total = plTotal();
    const ship = r && r.ships ? r.shipping : 0, bonus = r ? total - r.amount - ship : 0;
    setMain(`<div class="wrap page narrow">${head}
      <div class="panel"><h2>Review your pledge</h2>
        <div class="summary">
          <div><span>Reward</span><b>${r ? esc(r.title) : 'No reward'}</b></div>
          ${r ? `<div><span>Reward price</span><span>${money(r.amount, cur)}</span></div>` : ''}
          ${ship ? `<div><span>Shipping</span><span>${money(ship, cur)}</span></div>` : ''}
          ${r && bonus ? `<div><span>Bonus support</span><span>${money(bonus, cur)}</span></div>` : ''}
          ${r && r.est_delivery ? `<div><span>Estimated delivery</span><span>${fmtMonth(r.est_delivery)}</span></div>` : ''}
          <div class="total"><span>Total pledge</span><span>${money(total, cur)}</span></div>
        </div></div>
      <div style="display:grid;gap:12px;margin-top:16px">
        ${testNotice(p)}
        <div class="notice">${icon('info')}<div>You’ll only be charged if this project reaches its goal by <b>${fmtDateTime(p.deadline)}</b>. You can change or cancel your pledge until then.</div></div>
      </div>
      <form data-form="pledge" style="margin-top:20px">
        <label class="check"><input type="checkbox" name="ok" required><span>I understand that Groundswell doesn’t guarantee projects or rewards. The creator is responsible for delivering what they promised.</span></label>
        <div class="row" style="margin-top:20px"><button type="button" class="btn ghost" data-act="pl-back">${icon('chevL')}Back</button><button type="submit" class="btn primary lg" style="flex:1">${p.payments === 'stripe' && !(mine && mine.card) ? `Continue to payment \u00b7 ${money(total, cur)}` : `${mine ? 'Update pledge' : 'Pledge'} ${money(total, cur)}`}</button></div>
      </form></div>`);
    return;
  }
  const opt = (id, inner, disabled = false) => `<div class="reward ${sel === id ? 'sel' : ''} ${disabled ? 'soldout' : ''}" data-act="${disabled ? '' : 'pl-pick'}" data-id="${id}" role="radio" aria-checked="${sel === id}" tabindex="${disabled ? -1 : 0}"><span class="radio"></span>${inner}</div>`;
  const expand = id => {
    if (sel !== id) return '';
    if (id === 'none') return `<div class="expand"><label class="field" style="margin:0"><span>Pledge amount</span><div class="money"><span class="cur">${esc(curSymbol(cur))}</span><input class="input" data-pl="none" inputmode="decimal" value="${units(PL.extra.none ?? 100)}" aria-label="Pledge amount"></div></label>
      <div class="row between" style="margin-top:14px"><span class="muted small">Minimum ${money(100, cur)}</span><button class="btn primary" data-act="pl-next">Continue</button></div></div>`;
    const r = d.rewards.find(x => x.id === id);
    return `<div class="expand"><label class="field" style="margin:0"><span>Bonus support <small>optional</small></span><div class="money"><span class="cur">${esc(curSymbol(cur))}</span><input class="input" data-pl="${id}" inputmode="decimal" value="${units(PL.extra[id] || 0)}" aria-label="Bonus support"></div>
      <span class="hint">A bonus helps the project hit its goal, and doesn’t change your reward.</span></label>
      <div class="row between" style="margin-top:14px"><span><span class="muted small">Total</span> <b id="pl-total">${money(plTotal(), cur)}</b>${r.ships && r.shipping ? `<span class="muted small"> incl. ${money(r.shipping, cur)} shipping</span>` : ''}</span><button class="btn primary" data-act="pl-next">Continue</button></div></div>`;
  };
  setMain(`<div class="wrap page narrow">${head}
    <h2 style="font-size:22px;margin-bottom:6px">Select your reward</h2><p class="muted" style="margin-bottom:18px">Pick a reward, or pledge without one.</p>
    <div class="rewards" role="radiogroup" aria-label="Rewards">
      ${opt('none', `<div class="head"><div class="amt">Pledge without a reward</div><p class="desc">Back it because you believe in it.</p></div>${expand('none')}`)}
      ${d.rewards.map(r => {
        const soldOut = r.limit !== null && r.left === 0 && !(mine && mine.reward_id === r.id);
        return opt(r.id, `<div class="head"><div class="amt">${money(r.amount, cur)}</div><h3>${esc(r.title)}</h3>${r.description ? `<p class="desc">${esc(r.description)}</p>` : ''}
          ${r.items.length ? `<ul>${r.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
          <div class="facts">${r.est_delivery ? `<div><span>Estimated delivery</span><b>${fmtMonth(r.est_delivery)}</b></div>` : ''}<div><span>Ships</span><b>${r.ships ? (r.shipping ? `+${money(r.shipping, cur)}` : 'Free') : 'No shipping'}</b></div>
          <div><span>Backers</span><b>${r.backers}</b></div>${r.limit !== null ? `<div><span>Limited</span><b>${soldOut ? 'All gone' : `${r.left} left`}</b></div>` : ''}</div></div>${expand(r.id)}`, soldOut);
      }).join('')}
    </div>
    ${mine ? `<div class="panel" style="margin-top:28px"><h2>Cancel your pledge</h2><p class="muted" style="margin-bottom:14px">You can cancel any time before the campaign ends on ${fmtDate(p.deadline)}.</p><button class="btn danger" data-act="pl-cancel">Cancel my pledge</button></div>` : ''}
  </div>`);
  const sel0 = $('.reward.sel'); if (sel0 && sel0.scrollIntoView && PL._scroll) sel0.scrollIntoView({ block: 'center' });
  PL._scroll = false;
}
// Back from Stripe Checkout: confirm the saved card, then show the thank-you page.
async function pagePaid(ctx, slug) {
  if (!S.token) return needLogin(currentPath());
  setMain(`<div class="wrap page"><div class="thanks narrow"><div class="seal">${icon('lock')}</div><h1>Confirming your card\u2026</h1><p class="muted" style="margin-top:10px">This takes a moment.</p></div></div>`);
  let r;
  try { r = await gsFn('pay', { action: 'confirm', session: ctx.q.session || null, intent: ctx.q.intent || null }); }
  catch (e) { if (!ctx.stale()) setMain(errorPage(e)); return; }
  if (ctx.stale()) return;
  store.del('gs.paying'); PCACHE.delete(slug);
  if (r.done && r.kind === 'intent' && r.pledge) { THANKS = { slug, project: r.project, pledge: r.pledge }; return go(`/p/${slug}/thanks`); }
  if (r.done && r.kind === 'fix') { toast('Card saved. If a payment was due, we\u2019ll charge it in a minute or two.'); return go(`/p/${slug}`); }
  if (r.done) return go(`/p/${slug}`);
  setMain(`<div class="wrap page"><div class="empty"><h3>Your card wasn\u2019t saved</h3><p>Your pledge isn\u2019t complete yet. You can try again from the project page.</p><a class="btn primary" href="#/p/${slug}/pledge">Back to your pledge</a></div></div>`);
}
async function pageThanks(ctx, slug) {
  let t = THANKS && THANKS.slug === slug ? THANKS : null;
  if (!t) { const d = await getProject(slug, null, true); if (ctx.stale()) return; if (!d.me.pledge) return go('/p/' + slug); t = { slug, project: d.project, pledge: d.me.pledge }; }
  const p = t.project;
  setMain(`<div class="wrap page"><div class="thanks narrow">
    <div class="seal">${icon('check')}</div>
    <h1>You’re backer #${t.pledge.backer_no}!</h1>
    <p class="lede" style="margin:12px auto 0">Thanks for backing <b>${esc(p.title)}</b>. Your pledge of ${money(t.pledge.amount, p.currency)} is in. We’ll let you know in Activity when the creator posts updates, and when the campaign ends on ${fmtDate(p.deadline)}.</p>
    ${isTest(p) ? `<div style="max-width:560px;margin:20px auto 0;text-align:left">${testNotice(p)}</div>` : t.pledge.card ? `<p class="muted" style="margin-top:14px">${icon('lock', 'sm')} Your ${esc(cardText(t.pledge.card))} is saved with Stripe and charged only if the project is funded.</p>` : ''}
    <div class="row" style="justify-content:center;margin-top:24px"><button class="btn primary" data-act="share" data-slug="${p.slug}" data-title="${esc(p.title)}">${icon('share')}Share this project</button><a class="btn ghost" href="#/p/${p.slug}">Back to project</a></div>
  </div><section class="section" id="more-like"></section></div>`);
  try {
    const m = await rpc('gs_explore', { q: '', category: p.category, state: 'live', sort: 'magic', offset: 0 });
    const list = m.items.filter(x => x.id !== p.id).slice(0, 4);
    if (list.length && !ctx.stale()) $('#more-like').innerHTML = `<div class="section-head"><h2>More in ${esc(CAT[p.category])}</h2><a href="#/explore?cat=${p.category}">See all</a></div><div class="rowscroll">${list.map(c => card(c)).join('')}</div>`;
  } catch { /* optional */ }
}

// ------------------------------------------------------------ start a project
async function pageStart(ctx) {
  const mine = S.token ? await rpc('gs_mine').catch(() => null) : null;
  if (ctx.stale()) return;
  const drafts = mine ? mine.created.filter(c => c.status === 'draft') : [];
  const pick = ctx.q.cat || '';
  setMain(`<div class="wrap page"><div class="narrow" style="max-width:860px">
    <h1 class="page-title">Bring your idea to life</h1>
    <p class="lede">Start with a category and a working title. You can change both later, and nothing is public until you launch.</p>
    ${drafts.length ? `<div class="panel" style="margin-top:24px"><h2>Your drafts</h2><div style="display:grid;gap:10px">${drafts.map(c => `<a class="r-row" style="text-decoration:none;align-items:center" href="#/edit/${c.id}/basics"><span><b>${esc(c.title)}</b><br><span class="muted small">${esc(CAT[c.category])}</span></span>${icon('chevR')}</a>`).join('')}</div></div>` : ''}
    <form data-form="start" style="margin-top:28px">
      <div class="label">First, pick a category</div>
      <div class="catgrid" role="radiogroup" aria-label="Category" style="margin-bottom:24px">${CATS.map(([k, v]) => `<button type="button" class="cat-tile" data-act="pick-cat" data-cat="${k}" role="radio" aria-pressed="${pick === k}" aria-checked="${pick === k}">${esc(v)}</button>`).join('')}</div>
      <input type="hidden" name="category" value="${esc(pick)}">
      <div class="grid2"><label class="field"><span>Working title</span><input class="input" name="title" maxlength="80" placeholder="e.g. A pocket-sized weather station" required></label>
      <label class="field"><span>Currency</span><select class="select" name="currency">${CURRENCIES.map(([k, v]) => `<option value="${k}">${k} · ${v}</option>`).join('')}</select><span class="hint">Your goal and rewards use this currency. It can’t change after launch.</span></label></div>
      ${S.token ? '<button class="btn primary lg" type="submit">Create draft</button>' : `<a class="btn primary lg" href="#/signup?next=%2Fstart">Sign up to start</a> <a class="btn ghost lg" href="#/login?next=%2Fstart">Log in</a>`}
    </form>
    <div class="how section">
      <div class="step"><span class="n">1</span><h3>Draft it</h3><p>Write your story, set a goal and add rewards. Share a private preview link for feedback.</p></div>
      <div class="step"><span class="n">2</span><h3>Launch</h3><p>Your campaign runs for 1 to 60 days. Post updates and answer comments while it’s live.</p></div>
      <div class="step"><span class="n">3</span><h3>Get funded</h3><p>If you reach your goal, pledges are collected and you can start making. If not, nobody pays.</p></div>
    </div></div></div>`);
}

// ------------------------------------------------------------ project editor
let ED = null; // { p, step, patch, timer, saving }
const STEPS = [['basics', 'Basics'], ['rewards', 'Rewards'], ['story', 'Story'], ['faq', 'FAQ'], ['launch', 'Launch']];
async function pageEdit(ctx) {
  if (!S.token) return needLogin();
  const [, id, step = 'basics'] = ctx.parts;
  if (!ED || ED.p.id !== id) {
    setMain(loading());
    const p = await rpc('gs_project_edit', { project: id });
    if (ctx.stale()) return;
    ED = { p, patch: {}, timer: null, saving: false };
  }
  ED.step = STEPS.some(s => s[0] === step) ? step : 'basics';
  renderEditor();
}
function stepDone(step) {
  const c = ED.p.checklist.filter(x => x.step === step);
  if (step === 'faq') return ED.p.faqs.length > 0;
  if (step === 'launch') return ED.p.status !== 'draft';
  return c.length > 0 && c.every(x => x.ok);
}
function edNav() {
  return STEPS.map(([k, v]) => `<a href="#/edit/${ED.p.id}/${k}" ${k === ED.step ? 'aria-current="page"' : ''}><span class="tick ${stepDone(k) ? 'ok' : ''}">${stepDone(k) ? icon('check') : ''}</span>${v}</a>`).join('');
}
function renderEditor() {
  const p = ED.p;
  setMain(`<div class="ed-bar"><div class="wrap">
      <h1 title="${esc(p.title)}">${esc(p.title || 'Untitled project')}</h1>
      <span class="tag ${p.status === 'live' ? 'good' : ''}">${p.status === 'draft' ? 'Draft' : p.status[0].toUpperCase() + p.status.slice(1)}</span>
      <span class="savestate" id="savestate" aria-live="polite">${icon('check', 'sm')} Saved</span>
      <a class="btn ghost sm" href="#/p/${p.slug}">${icon('eye', 'sm')}${p.status === 'draft' ? 'Preview' : 'View'}</a>
      ${p.status === 'draft' ? `<a class="btn primary sm" href="#/edit/${p.id}/launch">${icon('rocket', 'sm')}Launch</a>` : `<a class="btn dark sm" href="#/dash/${p.id}">${icon('chart', 'sm')}Dashboard</a>`}
    </div></div>
    <div class="wrap ed"><nav class="steps" id="steps" aria-label="Editor steps">${edNav()}</nav><div class="ed-main" id="edmain">${edStep()}</div></div>`);
}
function refreshEdChrome() { const s = $('#steps'); if (s) s.innerHTML = edNav(); const h = $('.ed-bar h1'); if (h) h.textContent = ED.p.title || 'Untitled project'; }
function edStep() {
  const p = ED.p, L = p.locked, sym = esc(curSymbol(p.currency));
  if (ED.step === 'basics') {
    const ends = new Date(now() + p.duration * 864e5);
    return `<h2>Basics</h2><p class="lede">Make a good first impression: introduce your project and set your goal.</p>
      <section class="ed-sec">
        <label class="field"><span>Title <small><span data-count="title">${p.title.length}</span>/80</small></span><input class="input" data-field="title" maxlength="80" value="${esc(p.title)}"></label>
        <label class="field"><span>Subtitle <small><span data-count="blurb">${p.blurb.length}</span>/160</small></span><textarea class="textarea" style="min-height:80px" data-field="blurb" maxlength="160" placeholder="One sentence about what you’re making and why">${esc(p.blurb)}</textarea><span class="hint">Shown under your title on project cards and in search.</span></label>
        <div class="grid2">
          <label class="field"><span>Category</span><select class="select" data-field="category">${CATS.map(([k, v]) => `<option value="${k}" ${k === p.category ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
          <label class="field"><span>Location <small>optional</small></span><input class="input" data-field="location" maxlength="80" placeholder="City, region" value="${esc(p.location)}"></label>
        </div>
      </section>
      <section class="ed-sec"><div class="label">Project image</div>
        <div class="dropzone" id="drop">${cover(p, true)}<div class="over">
          <label class="btn sm">${icon('upload', 'sm')}${p.cover ? 'Replace' : 'Upload image'}<input type="file" accept="image/jpeg,image/png,image/webp" data-upload="cover" hidden></label>
          ${p.cover ? `<button class="btn sm" data-act="cover-clear">${icon('trash', 'sm')}Remove</button>` : `<button class="btn sm" data-act="cover-shuffle">${icon('sparkle', 'sm')}New art</button>`}</div></div>
        <span class="hint">16:9, at least 1024×576. Drag an image here, or use the button. Without one we generate cover art for you.</span>
        <label class="field" style="margin-top:18px"><span>Video <small>optional</small></span><input class="input" data-field="video" inputmode="url" placeholder="YouTube or Vimeo link" value="${esc(p.video)}"><span class="hint">Shown at the top of your page instead of the image.</span></label>
      </section>
      <section class="ed-sec"><h3 style="font-size:20px;margin-bottom:12px">Funding</h3>
        ${L ? `<div class="notice" style="margin-bottom:16px">${icon('lock')}<div>The goal, currency and duration are locked because your project has launched.</div></div>` : ''}
        <div class="grid2">
          <label class="field"><span>Currency</span><select class="select" data-field="currency" ${L ? 'disabled' : ''}>${CURRENCIES.map(([k, v]) => `<option value="${k}" ${k === p.currency ? 'selected' : ''}>${k} · ${v}</option>`).join('')}</select></label>
          <label class="field"><span>Funding goal</span><div class="money"><span class="cur" data-sym>${sym}</span><input class="input" data-field="goal" inputmode="decimal" value="${units(p.goal)}" ${L ? 'readonly' : ''}></div><span class="hint">All or nothing: you only get funded if you reach this.</span></label>
        </div>
        <label class="field"><span>Campaign duration <small><span data-count="duration">${p.duration}</span> days</small></span><input class="range" type="range" min="1" max="60" data-field="duration" value="${p.duration}" ${L ? 'disabled' : ''}>
          <span class="hint" id="ends">${L ? `Ends ${fmtDateTime(p.deadline)}` : `If you launch today, it ends ${fmtDate(ends.toISOString())}. Campaigns of 30 days or less tend to do best.`}</span></label>
      </section>`;
  }
  if (ED.step === 'rewards') {
    return `<h2>Rewards</h2><p class="lede">Offer simple, meaningful rewards. Most backers choose something in the middle of your range.</p>
      ${p.status !== 'draft' && p.status !== 'live' ? `<div class="notice">${icon('lock')}<div>The campaign has ended, so rewards can no longer change.</div></div>` : ''}
      <div class="r-list">${p.rewards.map(r => `<div class="r-row"><div style="min-width:0"><div class="muted small">${money(r.amount, p.currency)}${r.ships ? ` · ships${r.shipping ? ` +${money(r.shipping, p.currency)}` : ' free'}` : ''}${r.limit !== null ? ` · limit ${r.limit}` : ''}</div><h3>${esc(r.title)}</h3>
          <div class="muted small">${plural(r.backers, 'backer')}${r.est_delivery ? ` · delivers ${fmtMonth(r.est_delivery)}` : ''}</div></div>
          ${['draft', 'live'].includes(p.status) ? `<div class="row" style="flex:none"><button class="btn ghost sm" data-act="reward-edit" data-id="${r.id}">${icon('edit', 'sm')}Edit</button>${r.backers ? '' : `<button class="btn quiet sm" data-act="reward-del" data-id="${r.id}" aria-label="Delete ${esc(r.title)}">${icon('trash', 'sm')}</button>`}</div>` : ''}</div>`).join('') || '<div class="empty"><h3>No rewards yet</h3><p>Add at least one before you launch.</p></div>'}</div>
      ${['draft', 'live'].includes(p.status) ? `<button class="btn primary" data-act="reward-edit">${icon('plus')}Add a reward</button>` : ''}`;
  }
  if (ED.step === 'story') {
    return `<h2>Story</h2><p class="lede">Tell people why you’re passionate about this, what you’ll make, and how you’ll use the money.</p>
      <section class="ed-sec"><div class="label">Project story <small><span data-count="story">${p.story.length}</span> characters</small></div>${mdEditor('story', p.story, 'Start with what you’re making. Who are you? Why now? What will the funds pay for?')}</section>
      <section class="ed-sec"><label class="field"><span>Risks and challenges</span><textarea class="textarea" data-field="risks" maxlength="8000" placeholder="What could go wrong, and how will you handle it? Backers appreciate honesty.">${esc(p.risks)}</textarea></label></section>`;
  }
  if (ED.step === 'faq') {
    return `<h2>FAQ</h2><p class="lede">Answer the questions backers are likely to ask. You can add more after launch.</p>
      <div id="faqs">${(p.faqs.length ? p.faqs : []).map((f, i) => faqRow(f, i)).join('')}</div>
      <button class="btn ghost" data-act="faq-add">${icon('plus')}Add a question</button>`;
  }
  // launch
  const ready = p.checklist.every(x => x.ok);
  if (p.status !== 'draft') {
    return `<h2>${p.status === 'live' ? 'You’re live!' : 'Campaign ended'}</h2><p class="lede">${p.status === 'live' ? `Your campaign ends ${fmtDateTime(p.deadline)}.` : `Status: ${p.status}.`}</p>
      <div class="row"><a class="btn primary" href="#/p/${p.slug}">View project</a><a class="btn ghost" href="#/dash/${p.id}">Open dashboard</a><button class="btn ghost" data-act="share" data-slug="${p.slug}" data-title="${esc(p.title)}">${icon('share')}Share</button></div>
      ${p.status === 'live' ? `<section class="ed-sec" style="margin-top:32px"><h3 style="font-size:20px;margin-bottom:8px">Cancel this campaign</h3><p class="muted" style="margin-bottom:14px">Backers are told, and no pledges are collected. This can’t be undone.</p><button class="btn danger" data-act="proj-cancel">Cancel campaign</button></section>` : ''}`;
  }
  return `<h2>Launch</h2><p class="lede">Check everything over, then go live. Once you launch, the goal and duration are locked.</p>
    ${p.payments === 'stripe' ? `<div class="notice" style="margin-bottom:16px">${icon('lock')}<div><b>Real payments.</b> Backers save a card with Stripe and are charged only if you reach your goal. Groundswell keeps ${CONF.fee_bps / 100}%, and Stripe pays the rest out to your bank.</div></div>` : ''}
    <div class="checklist">${p.checklist.map(x => `<a class="${x.ok ? 'ok' : ''}" href="${x.step === 'payouts' ? '#/settings' : `#/edit/${p.id}/${x.step}`}"><span class="tick">${x.ok ? icon('check') : ''}</span><span>${esc(x.label)}</span><span class="go">${x.ok ? '' : icon('chevR')}</span></a>`).join('')}</div>
    <div class="panel"><div class="summary"><div><span>Goal</span><b>${money(p.goal, p.currency)}</b></div><div><span>Duration</span><b>${plural(p.duration, 'day')}</b></div><div><span>Ends if launched now</span><b>${fmtDateTime(new Date(now() + p.duration * 864e5).toISOString())}</b></div><div><span>Rewards</span><b>${p.rewards.length}</b></div></div></div>
    <div class="row" style="margin-top:20px"><button class="btn primary lg" data-act="launch" ${ready ? '' : 'disabled'}>${icon('rocket')}Launch project</button>
      <button class="btn ghost" data-act="copy-preview" data-url="${esc(projectUrl(p.slug) + '?preview=' + p.preview_key)}">${icon('link')}Copy preview link</button></div>
    ${ready ? '' : '<p class="hint">Finish the checklist to launch.</p>'}
    <section class="ed-sec" style="margin-top:40px"><h3 style="font-size:18px;margin-bottom:8px">Delete this draft</h3><p class="muted" style="margin-bottom:14px">Removes the draft and its rewards for good.</p><button class="btn danger" data-act="proj-delete">Delete draft</button></section>`;
}
const faqRow = (f, i) => `<div class="faq-row" data-faq="${i}"><label class="field"><span>Question</span><input class="input" data-faq-q maxlength="200" value="${esc(f.q)}"></label>
  <label class="field" style="margin-bottom:8px"><span>Answer</span><textarea class="textarea" style="min-height:90px" data-faq-a maxlength="2000">${esc(f.a)}</textarea></label>
  <div class="row"><button class="btn quiet sm" data-act="faq-move" data-dir="-1" aria-label="Move up">${icon('up', 'sm')}</button><button class="btn quiet sm" data-act="faq-move" data-dir="1" aria-label="Move down">${icon('down', 'sm')}</button><span style="flex:1"></span><button class="btn quiet sm" data-act="faq-del">${icon('trash', 'sm')}Remove</button></div></div>`;
function mdEditor(field, value, ph) {
  return `<div class="mdwrap" data-md="${field}"><div class="mdtool" role="toolbar" aria-label="Formatting">
    <button type="button" data-act="md" data-md-op="h" aria-label="Heading">${icon('heading')}</button><button type="button" data-act="md" data-md-op="b" aria-label="Bold">${icon('bold')}</button>
    <button type="button" data-act="md" data-md-op="i" aria-label="Italic">${icon('italic')}</button><button type="button" data-act="md" data-md-op="ul" aria-label="List">${icon('list')}</button>
    <button type="button" data-act="md" data-md-op="q" aria-label="Quote">${icon('quote')}</button><button type="button" data-act="md" data-md-op="a" aria-label="Link">${icon('link')}</button>
    <label class="btn quiet" style="width:36px;height:34px;min-height:0;padding:0" aria-label="Insert image">${icon('image')}<input type="file" accept="image/jpeg,image/png,image/webp" data-upload="story" hidden></label>
    <span class="sp"></span><button type="button" class="mode" data-act="md-mode" aria-pressed="false">Preview</button></div>
    <textarea class="textarea" data-field="${field}" ${field === 'story' ? 'maxlength="60000"' : ''} placeholder="${esc(ph)}">${esc(value)}</textarea><div class="preview prose" hidden></div>
    <span class="hint">Formatting: ## heading, **bold**, _italic_, - list, &gt; quote, [link](https://…)</span></div>`;
}
function setSaveState(t) { const el = $('#savestate'); if (el) el.innerHTML = t === 'saving' ? 'Saving…' : t === 'error' ? `<span style="color:var(--bad)">Not saved</span>` : `${icon('check', 'sm')} Saved`; }
// Patch keys that differ from the editor payload's field names.
const LOCAL_KEY = { goal_cents: 'goal', duration_days: 'duration' };
const applyLocal = (p, patch) => { for (const [k, v] of Object.entries(patch)) p[LOCAL_KEY[k] || k] = k === 'cover' ? (v || null) : v; return p; };
function queueSave(patch, now_ = false) {
  if (!ED) return;
  Object.assign(ED.patch, patch);
  applyLocal(ED.p, patch);
  setSaveState('saving');
  clearTimeout(ED.timer);
  ED.timer = setTimeout(flushSave, now_ ? 0 : 800);
}
async function flushSave() {
  if (!ED || !Object.keys(ED.patch).length) return;
  if (ED.saving) { clearTimeout(ED.timer); ED.timer = setTimeout(flushSave, 300); return; }
  const ed = ED, patch = ed.patch; ed.patch = {}; ed.saving = true;
  try {
    const p = await rpc('gs_project_save', { project: ed.p.id, patch });
    ed.p = applyLocal(p, ed.patch); // keep edits made while this save was in flight
    PCACHE.delete(p.slug);
    if (ED === ed) { setSaveState(Object.keys(ed.patch).length ? 'saving' : 'saved'); refreshEdChrome(); }
  } catch (e) {
    if (ED === ed) { setSaveState('error'); toast(e.message, 'bad'); }
  } finally { ed.saving = false; }
}
function rewardForm(r) {
  const p = ED.p, sym = esc(curSymbol(p.currency)), locked = r && r.backers > 0;
  r = r || { title: '', amount: null, description: '', items: [], ships: false, shipping: 0, est_delivery: '', limit: null };
  const m = modal(`<h2>${r.id ? 'Edit reward' : 'Add a reward'}</h2>
    <form data-form="reward" data-id="${r.id || ''}">
      ${locked ? `<div class="notice" style="margin-bottom:14px">${icon('lock')}<div>${plural(r.backers, 'backer has', 'backers have')} chosen this reward, so its price and shipping are locked.</div></div>` : ''}
      <label class="field"><span>Title</span><input class="input" name="title" maxlength="80" required value="${esc(r.title)}" placeholder="e.g. Early bird lamp"></label>
      <label class="field"><span>Amount</span><div class="money"><span class="cur">${sym}</span><input class="input" name="amount" inputmode="decimal" required value="${units(r.amount)}" ${locked ? 'readonly' : ''}></div></label>
      <label class="field"><span>Description</span><textarea class="textarea" name="description" maxlength="1500" style="min-height:90px">${esc(r.description)}</textarea></label>
      <div class="field"><span class="label">What’s included <small>press Enter after each</small></span><div class="items-input" data-items>${r.items.map(i => itemChip(i)).join('')}<input aria-label="Add an item" placeholder="Add an item" maxlength="80" data-item-input></div></div>
      <label class="field"><span>Estimated delivery <small>optional</small></span><input class="input" type="month" name="est_delivery" value="${esc(r.est_delivery || '')}"></label>
      <fieldset class="field" style="border:0;padding:0;margin:0 0 18px"><legend class="label">Shipping</legend>
        <label class="check" style="margin-bottom:8px"><input type="radio" name="ships" value="no" ${!r.ships ? 'checked' : ''} ${locked ? 'disabled' : ''}><span>No shipping (digital or in person)</span></label>
        <label class="check"><input type="radio" name="ships" value="yes" ${r.ships ? 'checked' : ''} ${locked ? 'disabled' : ''}><span>Ships worldwide</span></label>
        <div class="money" style="margin-top:10px" data-shipwrap ${r.ships ? '' : 'hidden'}><span class="cur">${sym}</span><input class="input" name="shipping" inputmode="decimal" value="${units(r.shipping)}" aria-label="Shipping cost" ${locked ? 'readonly' : ''}></div></fieldset>
      <label class="check" style="margin-bottom:10px"><input type="checkbox" name="limited" ${r.limit !== null ? 'checked' : ''}><span>Limit how many are available</span></label>
      <input class="input" name="limit" inputmode="numeric" value="${r.limit ?? ''}" aria-label="Quantity available" placeholder="Quantity" ${r.limit !== null ? '' : 'hidden'}>
      <div class="acts"><button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" class="btn primary">Save reward</button></div>
    </form>`);
  const f = $('form', m.el); f._close = m.close;
  f.addEventListener('change', e => {
    if (e.target.name === 'ships') $('[data-shipwrap]', f).hidden = e.target.value !== 'yes';
    if (e.target.name === 'limited') f.limit.hidden = !e.target.checked;
  });
}
const itemChip = t => `<span class="chip" data-item="${esc(t)}">${esc(t)}<button type="button" data-act="item-del" aria-label="Remove ${esc(t)}">${icon('x', 'sm')}</button></span>`;
function collectFaqs() { return $$('#faqs [data-faq]').map(r => ({ q: $('[data-faq-q]', r).value, a: $('[data-faq-a]', r).value })); }
function mdOp(wrap, op) {
  const ta = $('textarea', wrap), s = ta.selectionStart, e = ta.selectionEnd, v = ta.value, sel = v.slice(s, e);
  const lineStart = v.lastIndexOf('\n', s - 1) + 1;
  let out, cs, ce;
  const wrapWith = (a, b, ph) => { const t = sel || ph; out = v.slice(0, s) + a + t + b + v.slice(e); cs = s + a.length; ce = cs + t.length; };
  const prefix = pre => { out = v.slice(0, lineStart) + pre + v.slice(lineStart); cs = s + pre.length; ce = e + pre.length; };
  if (op === 'b') wrapWith('**', '**', 'bold text');
  else if (op === 'i') wrapWith('_', '_', 'italic text');
  else if (op === 'a') { wrapWith('[', '](https://)', sel || 'link text'); cs = ce + 2; ce = cs + 8; }
  else if (op === 'h') prefix('## ');
  else if (op === 'ul') prefix('- ');
  else if (op === 'q') prefix('> ');
  ta.value = out; ta.focus(); ta.setSelectionRange(cs, ce);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}
function insertAtCursor(ta, text) {
  const s = ta.selectionStart ?? ta.value.length, v = ta.value;
  const pre = s > 0 && v[s - 1] !== '\n' ? '\n\n' : '';
  ta.value = v.slice(0, s) + pre + text + '\n' + v.slice(s);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

// ------------------------------------------------------------ creator dashboard
let DASH = null;
async function pageDash(ctx) {
  if (!S.token) return needLogin();
  const id = ctx.parts[1];
  setMain(loading());
  const d = await rpc('gs_dashboard', { project: id });
  if (ctx.stale()) return;
  DASH = { d, editing: null };
  renderDash(ctx.q.tab || 'overview');
}
function renderDash(tab) {
  const d = DASH.d, p = d.project, cur = p.currency, live = p.status === 'live';
  const avg = p.backers ? Math.round(p.pledged / p.backers) : 0, t = live ? timeLeft(p.deadline) : null;
  const tabs = [['overview', 'Overview'], ['backers', `Backers`], ['updates', 'Updates']];
  let body = '';
  if (tab === 'overview') {
    const rw = p.rewards.map(r => ({ name: r.title, n: r.backers })).concat([{ name: 'No reward', n: d.no_reward }]);
    const maxN = Math.max(1, ...rw.map(r => r.n));
    body = `<div class="kpis" style="margin-top:20px">
        <div class="kpi"><div class="l">Pledged</div><div class="v">${money(p.pledged, cur)}</div><div class="d">${pctOf(p)}% of ${money(p.goal, cur)}</div></div>
        <div class="kpi"><div class="l">Backers</div><div class="v">${p.backers.toLocaleString()}</div><div class="d">${d.canceled ? `${d.canceled} canceled` : ' '}</div></div>
        <div class="kpi"><div class="l">Average pledge</div><div class="v">${money(avg, cur)}</div><div class="d">${plural(d.saves, 'person', 'people')} saved it</div></div>
        <div class="kpi"><div class="l">${live ? 'Time left' : 'Ended'}</div><div class="v">${live ? `${t.n} ${t.unit}` : fmtDate(p.ended_at, { month: 'short', day: 'numeric' })}</div><div class="d">${live ? `Ends ${fmtDate(p.deadline)}` : p.status}</div></div>
      </div>
      ${afterPanels(d) ? `<div class="dash-grid">${afterPanels(d)}</div>` : ''}
      <div class="dash-grid">
        <div class="panel"><div class="row between"><h2 style="margin:0">Funding over time</h2><button class="btn quiet sm" data-act="dash-table">Show as table</button></div><p class="muted small" style="margin:4px 0 14px">Total pledged since launch, against your goal.</p><div class="chart" id="chart"></div><div id="chart-table" hidden></div></div>
        <div class="panel"><h2>Backers by reward</h2><div class="hbars">${rw.map(r => `<div class="hbar"><div class="t"><span>${esc(r.name)}</span><span class="num">${r.n.toLocaleString()}</span></div><div class="track"><i style="width:${(r.n / maxN) * 100}%"></i></div></div>`).join('')}</div></div>
      </div>`;
  } else if (tab === 'backers') {
    body = `<div class="row between" style="margin:20px 0 14px"><p class="muted">${plural(d.backers.length, 'backer')}${d.canceled ? ` · ${d.canceled} canceled` : ''}</p>${d.backers.length ? `<button class="btn ghost sm" data-act="csv">${icon('download', 'sm')}Download CSV</button>` : ''}</div>
      ${d.survey.sent_at ? '' : afterPanels(d)}
      ${d.backers.length ? `<div class="table-wrap"><table><thead><tr><th>#</th><th>Backer</th><th>Reward</th><th class="r">Pledge</th><th>Date</th><th>Status</th>${d.survey.sent_at ? '<th>Ship to</th>' : ''}</tr></thead><tbody>
        ${d.backers.map(b => `<tr><td class="num">${b.no}</td><td>${b.user.username ? `<a href="#/u/${esc(b.user.username)}">${esc(b.user.name)}</a>` : esc(b.user.name)}</td><td>${esc(b.reward || 'No reward')}</td><td class="r num">${money(b.amount, cur)}</td><td>${fmtDate(b.at)}</td><td>${pledgeStatus({ status: b.status, charge_status: b.charge }, p.payments)}</td>${d.survey.sent_at ? `<td style="white-space:normal;min-width:180px">${b.address ? esc([b.address.name, b.address.line1, b.address.line2, b.address.city, b.address.region, b.address.postal, b.address.country].filter(Boolean).join(', ')) : b.ships ? '<span class="muted">Waiting</span>' : '<span class="muted">\u2014</span>'}</td>` : ''}</tr>`).join('')}
      </tbody></table></div>` : '<div class="empty"><h3>No backers yet</h3><p>Share your project to get the word out.</p></div>'}`;
  } else {
    const e = DASH.editing && d.updates.find(u => u.id === DASH.editing);
    body = `<div class="panel" style="margin-top:20px"><h2>${e ? `Edit update #${e.n}` : 'Post an update'}</h2>
        <form data-form="update" data-id="${e ? e.id : ''}">
          <label class="field"><span>Title</span><input class="input" name="title" maxlength="120" required value="${esc(e ? e.title : '')}"></label>
          <div class="field"><span class="label">Update</span>${mdEditor('body', e ? e.body : '', 'Share progress, photos, or news. Backers get a notification.')}</div>
          <label class="check" style="margin-bottom:18px"><input type="checkbox" name="backers_only" ${e && e.backers_only ? 'checked' : ''}><span>Backers only</span></label>
          <div class="row">${e ? '<button type="button" class="btn ghost" data-act="upd-cancel">Cancel</button>' : ''}<button type="submit" class="btn primary">${e ? 'Save changes' : 'Post update'}</button></div>
        </form></div>
      <div style="margin-top:20px">${d.updates.map(u => `<div class="r-row" style="margin-bottom:10px"><div><span class="tag">Update #${u.n}</span>${u.backers_only ? ' <span class="tag accent">Backers only</span>' : ''}<h3 style="margin-top:6px">${esc(u.title)}</h3><div class="muted small">${fmtDate(u.created_at)}</div></div>
        <div class="row" style="flex:none"><a class="btn quiet sm" href="#/p/${p.slug}/updates/${u.n}">${icon('eye', 'sm')}</a><button class="btn ghost sm" data-act="upd-edit" data-id="${u.id}">${icon('edit', 'sm')}Edit</button><button class="btn quiet sm" data-act="upd-del" data-id="${u.id}" aria-label="Delete update">${icon('trash', 'sm')}</button></div></div>`).join('')}</div>`;
  }
  setMain(`<div class="wrap page">
    <div class="row between"><div><p class="muted small">Creator dashboard</p><h1 class="page-title" style="margin:0">${esc(p.title)}</h1></div>
      <div class="row"><a class="btn ghost sm" href="#/p/${p.slug}">${icon('eye', 'sm')}View</a><a class="btn ghost sm" href="#/edit/${p.id}/basics">${icon('edit', 'sm')}Edit</a></div></div>
    <nav class="tabs" style="margin-top:20px" aria-label="Dashboard sections">${tabs.map(([k, v]) => `<button data-act="dash-tab" data-tab="${k}" aria-selected="${k === tab}">${v}</button>`).join('')}</nav>
    ${body}</div>`);
  DASH.tab = tab;
  drawChart();
}
// Drawn at the container's real width so labels stay 12px on phones.
function drawChart() {
  const el = $('#chart'); if (!el || !DASH) return;
  el.innerHTML = fundingChart(DASH.d, Math.max(280, Math.round(el.clientWidth)));
  bindChart();
}
window.addEventListener('resize', debounce(() => { if (DASH && $('#chart') && !$('#chart').hidden) drawChart(); }, 150));
function pledgeStatus(pl, payments) {
  if (payments === 'stripe' && pl.charge_status) return { due: '<span class="tag">Charging soon</span>', processing: '<span class="tag">Charging</span>', paid: '<span class="tag good">Paid</span>', failed: '<span class="tag bad">Payment failed</span>', abandoned: '<span class="tag bad">Dropped</span>' }[pl.charge_status];
  return { active: '<span class="tag">Active</span>', collected: `<span class="tag good">Collected${payments === 'stripe' ? '' : ' (test)'}</span>`, dropped: '<span class="tag">Not collected</span>', canceled: '<span class="tag bad">Canceled</span>' }[pl.status] || esc(pl.status);
}
// Payments and shipping survey panels for a finished project.
function afterPanels(d) {
  const p = d.project, cur = p.currency, pay = d.payments, sv = d.survey;
  let out = '';
  if (p.status === 'successful' && pay.mode === 'stripe') {
    const fee = Math.floor(pay.paid * pay.fee_bps / 10000);
    out += `<div class="panel"><h2>Payments</h2><div class="summary">
      <div><span>Collected from ${plural(pay.paid_count, 'backer')}</span><b>${money(pay.paid, cur)}</b></div>
      <div><span>Groundswell fee (${pay.fee_bps / 100}%)</span><span>\u2212${money(fee, cur)}</span></div>
      <div class="total"><span>Paid out to your Stripe account</span><span>${money(pay.paid - fee, cur)}</span></div></div>
      <p class="muted small" style="margin-top:12px">${pay.pending_count ? `${plural(pay.pending_count, 'card')} still being charged. ` : ''}${pay.failed_count ? `${plural(pay.failed_count, 'backer')} need to update their card (they have 7 days). ` : ''}${pay.abandoned_count ? `${plural(pay.abandoned_count, 'pledge')} dropped after failed payments. ` : ''}Stripe pays out to your bank on its usual schedule.</p></div>`;
  }
  if (p.status === 'successful' && sv.shipping > 0) {
    out += `<div class="panel"><h2>Shipping survey</h2>${sv.sent_at
      ? `<p>Sent ${fmtDate(sv.sent_at)}. <b>${sv.answered} of ${sv.shipping}</b> backers have entered an address. Addresses are in the backer list and the CSV.</p>`
      : `<p class="muted" style="margin-bottom:14px">${plural(sv.shipping, 'backer')} chose a reward that ships. Ask them where to send it.</p><button class="btn primary" data-act="survey-send">${icon('truck')}Send shipping survey</button>`}</div>`;
  }
  return out;
}
// Daily cumulative totals from launch to today (or the end date).
function dailySeries(d) {
  const p = d.project, day = 864e5;
  const l = new Date(p.launched_at), start = Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate());
  const endT = p.status === 'live' ? Math.min(now(), Date.parse(p.deadline)) : Date.parse(p.ended_at || p.deadline);
  const map = new Map(d.series.map(s => [s.day, s]));
  const out = []; let last = { pledged: 0, backers: 0 };
  for (let t = start; t <= endT + 1; t += day) {
    const key = new Date(t).toISOString().slice(0, 10);
    if (map.has(key)) last = map.get(key);
    out.push({ t, key, pledged: +last.pledged, backers: +last.backers });
  }
  // Server days are UTC; make sure the final point shows the live total.
  if (out.length) { out[out.length - 1].pledged = p.pledged; out[out.length - 1].backers = p.backers; }
  return out;
}
function niceMax(v) { if (v <= 0) return 100; const e = Math.pow(10, Math.floor(Math.log10(v))); return [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(f => f * e >= v) * e; }
function fundingChart(d, W) {
  const p = d.project, pts = dailySeries(d), H = W < 520 ? 220 : 260, L = 60, R = 40, T = 14, B = 28;
  const startT = pts.length ? pts[0].t : Date.parse(p.launched_at);
  const endT = Math.max(startT + 864e5, Date.parse(p.status === 'live' ? p.deadline : (p.ended_at || p.deadline)));
  const maxV = niceMax(Math.max(p.goal, ...pts.map(x => x.pledged)) * 1.08);
  const x = t => L + ((t - startT) / (endT - startT)) * (W - L - R), y = v => T + (1 - v / maxV) * (H - T - B);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => f * maxV);
  const cur = p.currency, short = v => money(v, cur, { compact: true }).replace(/\.00$/, '');
  const line = pts.map((s, i) => `${i ? 'L' : 'M'}${x(s.t).toFixed(1)} ${y(s.pledged).toFixed(1)}`).join(' ');
  const lastP = pts[pts.length - 1];
  const area = pts.length ? `${line} L${x(lastP.t).toFixed(1)} ${y(0)} L${x(pts[0].t).toFixed(1)} ${y(0)} Z` : '';
  const fmtAx = t => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  DASH.pts = pts; DASH.geo = { x, y, W, H, L, R, T, B, cur };
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Pledged over time: ${money(p.pledged, cur)} of a ${money(p.goal, cur)} goal">
    <g class="grid">${ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>`).join('')}</g>
    <g class="axis">${ticks.map(v => `<text x="${L - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${short(v)}</text>`).join('')}
      <text x="${L}" y="${H - 6}">${fmtAx(startT)}</text><text x="${W - R}" y="${H - 6}" text-anchor="end">${fmtAx(endT)}</text></g>
    <g class="goal"><line x1="${L}" x2="${W - R}" y1="${y(p.goal).toFixed(1)}" y2="${y(p.goal).toFixed(1)}"/><text x="${W - R + 5}" y="${(y(p.goal) + 4).toFixed(1)}">Goal</text></g>
    ${pts.length ? `<path class="area" d="${area}"/><path class="line" d="${line}"/>
      <circle class="end" cx="${x(lastP.t).toFixed(1)}" cy="${y(lastP.pledged).toFixed(1)}" r="5"/>
      <text class="endlbl" ${x(lastP.t) + 70 > W ? `text-anchor="end" x="${(x(lastP.t) - 9).toFixed(1)}"` : `x="${(x(lastP.t) + 9).toFixed(1)}"`} y="${(y(lastP.pledged) + (Math.abs(y(lastP.pledged) - y(p.goal)) < 14 ? 16 : 4)).toFixed(1)}">${short(lastP.pledged)}</text>` : ''}
    <line class="xh" id="xh" y1="${T}" y2="${H - B}" hidden/>
    <rect class="hit" id="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" tabindex="0" aria-label="Chart: use arrow keys to read daily totals"/>
  </svg><div class="tip" id="tip" hidden></div>`;
}
function bindChart() {
  const svg = $('#chart svg'), hit = $('#hit'), tip = $('#tip'), xh = $('#xh');
  if (!svg || !DASH.pts || !DASH.pts.length) return;
  let idx = DASH.pts.length - 1;
  const show = i => {
    idx = Math.max(0, Math.min(DASH.pts.length - 1, i));
    const s = DASH.pts[idx], g = DASH.geo, px = g.x(s.t), box = svg.getBoundingClientRect(), k = box.width / g.W;
    xh.setAttribute('x1', px); xh.setAttribute('x2', px); xh.removeAttribute('hidden');
    tip.hidden = false;
    tip.innerHTML = `<div class="muted small">${new Date(s.t).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</div><b>${money(s.pledged, g.cur)}</b><div class="k"><i></i>Pledged · ${plural(s.backers, 'backer')}</div>`;
    const left = px * k + 12, w = tip.offsetWidth;
    tip.style.left = `${left + w > box.width ? px * k - w - 12 : left}px`; tip.style.top = `${g.y(s.pledged) * k - 20}px`;
  };
  const hide = () => { tip.hidden = true; xh.setAttribute('hidden', ''); };
  const at = e => { const g = DASH.geo, box = svg.getBoundingClientRect(), vx = (e.clientX - box.left) * (g.W / box.width);
    let best = 0, bd = Infinity; DASH.pts.forEach((s, i) => { const dd = Math.abs(g.x(s.t) - vx); if (dd < bd) { bd = dd; best = i; } }); return best; };
  hit.addEventListener('pointermove', e => show(at(e)));
  hit.addEventListener('pointerleave', hide);
  hit.addEventListener('focus', () => show(idx));
  hit.addEventListener('blur', hide);
  hit.addEventListener('keydown', e => { if (e.key === 'ArrowLeft') { e.preventDefault(); show(idx - 1); } if (e.key === 'ArrowRight') { e.preventDefault(); show(idx + 1); } });
}
function csvDownload() {
  const d = DASH.d, cur = d.project.currency;
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const A = ['name', 'line1', 'line2', 'city', 'region', 'postal', 'country', 'phone'];
  const rows = [['Backer #', 'Name', 'Username', 'Reward', `Pledge (${cur})`, `Shipping (${cur})`, 'Status', 'Payment', 'Date', ...A.map(k => `Ship to: ${k}`)].map(q).join(',')]
    .concat(d.backers.map(b => [b.no, b.user.name, b.user.username || '', b.reward || 'No reward', (b.amount / 100).toFixed(2), (b.shipping / 100).toFixed(2), b.status, b.charge || '', b.at, ...A.map(k => b.address ? b.address[k] : '')].map(q).join(',')));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }));
  a.download = `${d.project.slug}-backers.csv`; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ------------------------------------------------------------ people
async function pageUser(ctx) {
  const [, username, tab = 'created'] = ctx.parts;
  setMain(loading());
  const d = await rpc('gs_user', { username });
  if (ctx.stale()) return;
  const u = d.user, list = tab === 'backed' ? d.backed : d.created;
  setMain(`<div class="wrap page">
    <div class="prof">${avatar(u, 96)}<div style="flex:1;min-width:220px"><h1>${esc(u.name)}</h1><p class="muted">@${esc(u.username)}${u.location ? ` · ${esc(u.location)}` : ''} · Joined ${fmtDate(u.joined, { month: 'long', year: 'numeric' })}</p>${u.bio ? `<p class="bio">${esc(u.bio)}</p>` : ''}</div>
      ${u.self ? '<a class="btn ghost" href="#/settings">Edit profile</a>'
        : S.me ? `<button class="btn ${u.blocked ? 'ghost' : 'quiet'}" data-act="${u.blocked ? 'unblock' : 'block'}" data-username="${esc(u.username)}" data-name="${esc(u.name)}">${u.blocked ? 'Unblock' : 'Block'}</button>` : ''}</div>
    ${u.blocked ? `<div class="notice" style="margin-top:18px">${icon('info')}<div>You blocked ${esc(u.name)}. You won’t see their comments, and they can’t comment on your projects or send you notifications.</div></div>` : ''}
    <nav class="tabs" style="margin:24px 0" aria-label="Profile sections"><a href="#/u/${esc(u.username)}" ${tab !== 'backed' ? 'aria-current="page"' : ''}>Created<span class="count">${d.created.length}</span></a><a href="#/u/${esc(u.username)}/backed" ${tab === 'backed' ? 'aria-current="page"' : ''}>Backed<span class="count">${u.backed_count}</span></a></nav>
    ${tab === 'backed' && !d.backed ? `<div class="empty"><h3>Backed projects are private</h3><p>${esc(u.name)} has chosen not to show what they back.</p></div>`
      : list.length ? cards(list, { }) : `<div class="empty"><h3>Nothing here yet</h3>${u.self && tab !== 'backed' ? '<a class="btn primary" href="#/start">Start a project</a>' : ''}</div>`}
  </div>`);
}
async function pageMe(ctx) {
  if (!S.token) return needLogin('/me');
  const tab = ctx.parts[1] || 'backed';
  setMain(loading());
  const d = await rpc('gs_mine');
  if (ctx.stale()) return;
  let body;
  if (tab === 'saved') body = d.saved.length ? cards(d.saved) : '<div class="empty"><h3>No saved projects</h3><p>Tap the bookmark on any project and we’ll remind you 48 hours before it ends.</p><a class="btn primary" href="#/explore">Discover projects</a></div>';
  else if (tab === 'created') body = d.created.length ? `<div class="cards">${d.created.map(c => `<div style="display:flex;flex-direction:column">${card(c, { href: c.status === 'draft' ? `#/edit/${c.id}/basics` : null })}<div class="row" style="margin-top:12px">${c.status === 'draft' ? `<a class="btn dark sm" href="#/edit/${c.id}/basics">Continue editing</a>` : `<a class="btn dark sm" href="#/dash/${c.id}">${icon('chart', 'sm')}Dashboard</a><a class="btn ghost sm" href="#/edit/${c.id}/basics">Edit</a>`}</div></div>`).join('')}</div>`
    : '<div class="empty"><h3>You haven’t started a project</h3><p>Have an idea? Drafts are private until you launch.</p><a class="btn primary" href="#/start">Start a project</a></div>';
  else body = d.backed.length ? `<div class="cards">${d.backed.map(c => `<div style="display:flex;flex-direction:column">${card(c)}<div class="panel" style="margin-top:12px;padding:12px 14px"><div class="row between"><b>${money(c.pledge.amount, c.currency)}</b>${pledgeStatus(c.pledge, c.payments)}</div><div class="muted small">${c.pledge.reward ? esc(c.pledge.reward) : 'No reward'} · backer #${c.pledge.backer_no}</div>${c.status === 'live' && c.pledge.status === 'active' ? `<a class="btn ghost sm" style="margin-top:10px" href="#/p/${c.slug}/pledge">Manage pledge</a>` : ''}</div></div>`).join('')}</div>`
    : '<div class="empty"><h3>You haven’t backed anything yet</h3><p>Find something you’d love to see exist.</p><a class="btn primary" href="#/explore">Discover projects</a></div>';
  setMain(`<div class="wrap page"><h1 class="page-title">Your projects</h1>
    <nav class="tabs" style="margin:16px 0 24px" aria-label="Your projects"><a href="#/me" ${tab === 'backed' ? 'aria-current="page"' : ''}>Backed<span class="count">${d.backed.length}</span></a><a href="#/me/saved" ${tab === 'saved' ? 'aria-current="page"' : ''}>Saved<span class="count">${d.saved.length}</span></a><a href="#/me/created" ${tab === 'created' ? 'aria-current="page"' : ''}>Created<span class="count">${d.created.length}</span></a></nav>
    ${body}</div>`);
}
function noteText(n) {
  const t = `<b>${esc(n.project ? n.project.title : 'A project')}</b>`, a = n.actor ? `<b>${esc(n.actor.name)}</b>` : 'Someone', x = n.data || {};
  switch (n.kind) {
    case 'first_backer': return `${a} became the first backer of ${t}. Congratulations!`;
    case 'milestone': return `${t} is ${x.pct}% funded!`;
    case 'funded': return `${t} reached its goal! Thanks for backing it.`;
    case 'update': return `${t} posted Update #${x.n}: ${esc(x.title)}`;
    case 'comment': return `${a} commented on ${t}${x.n ? ` (Update #${x.n})` : ''}: “${esc(x.excerpt)}”`;
    case 'reply': return `${a} replied to your comment on ${t}: “${esc(x.excerpt)}”`;
    case 'ended':
      if (x.role === 'creator') return x.result === 'successful' ? `Your project ${t} was successfully funded with ${money(n.project.pledged, n.project.currency)}!` : `Your project ${t} didn’t reach its goal. No backers were charged.`;
      return x.result === 'successful' ? `${t} was successfully funded. ${x.payments === 'stripe' ? 'Your card will be charged shortly.' : 'Your pledge was collected (test mode, no money moved).'}` : `${t} didn’t reach its goal. Your pledge was not collected.`;
    case 'canceled': return `The creator canceled ${t}. Your pledge was not collected.`;
    case 'ending_soon': return `${t}, which you saved, ends in less than 48 hours.`;
    case 'survey': return `${t} is getting ready to ship. Enter your shipping address.`;
    case 'payment_failed': return `Your payment for ${t} didn\u2019t go through. Update your card within 7 days to keep your pledge.`;
    case 'charged': return `Your card was charged ${money(x.amount || 0, n.project.currency)} for ${t}. Thank you!`;
    case 'report': return `New report on ${x.comment ? `a comment on ${t}` : t}: “${esc(x.reason || '')}”`;
    default: return t;
  }
}
function noteHref(n) {
  if (n.kind === 'report') return '#/admin';
  if (!n.project) return '#/activity';
  const b = `#/p/${n.project.slug}`, x = n.data || {};
  if (n.kind === 'update') return `${b}/updates/${x.n}`;
  if (n.kind === 'comment' || n.kind === 'reply') return x.n ? `${b}/updates/${x.n}` : `${b}/comments`;
  return b;
}
async function pageActivity(ctx) {
  if (!S.token) return needLogin('/activity');
  setMain(loading());
  const d = await rpc('gs_notifications');
  if (ctx.stale()) return;
  setMain(`<div class="wrap page narrow"><h1 class="page-title">Activity</h1>
    ${d.items.length ? `<div class="notes" style="margin-top:16px">${d.items.map(n => `<a class="note ${n.read ? '' : 'unread'}" href="${noteHref(n)}">${n.project ? `<div class="thumb">${coverInner(n.project)}</div>` : ''}<div class="msg">${noteText(n)}<div class="when">${ago(n.at)}</div></div>${n.read ? '' : '<span class="pip" aria-label="New"></span>'}</a>`).join('')}</div>`
      : '<div class="empty" style="margin-top:20px"><h3>Nothing yet</h3><p>Updates from projects you back, replies to your comments, and news about your own projects show up here.</p></div>'}</div>`);
  if (d.items.some(n => !n.read)) { rpc('gs_notifications_read').then(() => { S.unread = 0; renderChrome(); }).catch(() => {}); }
}

// ------------------------------------------------------------ account pages
function authPage(kind, ctx) {
  const next = ctx.q.next || '/';
  if (S.token && kind !== 'forgot') { go(next); return; }
  const nx = encodeURIComponent(next);
  const forms = {
    login: `<h1>Welcome back</h1><p class="lede">Log in to back projects and manage your own.</p>
      <form data-form="login"><label class="field"><span>Username</span><input class="input" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
      <label class="field"><span>Password</span><input class="input" name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn primary block lg" type="submit">Log in</button></form>
      <p class="alt"><a href="#/forgot?next=${nx}">Forgot password?</a></p><p class="alt">New to Groundswell? <a href="#/signup?next=${nx}">Sign up</a></p>`,
    signup: `<h1>Join Groundswell</h1><p class="lede">Back projects, save favorites, and start your own.</p>
      <form data-form="signup"><label class="field"><span>Name</span><input class="input" name="name" autocomplete="name" maxlength="60" required placeholder="How you’ll appear to others"></label>
      <label class="field"><span>Username</span><input class="input" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" pattern="[A-Za-z0-9_]{3,24}" maxlength="24" required><span class="hint">3–24 letters, numbers or underscores.</span></label>
      <label class="field"><span>Password</span><input class="input" name="password" type="password" autocomplete="new-password" minlength="8" maxlength="72" required><span class="hint">At least 8 characters.</span></label>
      <button class="btn primary block lg" type="submit">Create account</button>
      <p class="hint" style="text-align:center;margin-top:12px">By signing up you agree to the <a href="terms.html">Terms</a> and <a href="privacy.html">Privacy policy</a>. No email needed.</p></form>
      <p class="alt">Already have an account? <a href="#/login?next=${nx}">Log in</a></p>`,
    forgot: `<h1>Reset your password</h1><p class="lede">Use a code we email you, or the recovery code you saved when you signed up.</p>
      <form data-form="forgot"><label class="field"><span>Username</span><input class="input" name="username" autocapitalize="none" spellcheck="false" required value="${esc(ctx.q.username || '')}"></label>
      <p class="hint" style="margin:-8px 0 16px"><button type="button" class="linkbtn" data-act="reset-email">Email me a code</button> (works if your account has a confirmed email)</p>
      <label class="field"><span>Code</span><input class="input" name="code" autocapitalize="characters" spellcheck="false" placeholder="Emailed code or recovery code" required></label>
      <label class="field"><span>New password</span><input class="input" name="password" type="password" autocomplete="new-password" minlength="8" maxlength="72" required></label>
      <button class="btn primary block lg" type="submit">Reset password</button></form>
      <p class="alt"><a href="#/login?next=${nx}">Back to log in</a></p>`,
  };
  setMain(`<div class="wrap"><div class="auth-card">${forms[kind]}</div></div>`);
  const first = $('#main input'); first && first.focus();
}
function showRecovery(code, then) {
  const m = modal(`<h2>Save your recovery code</h2>
    <p class="muted" style="margin-bottom:14px">If you forget your password, this code gets you back into your account. Keep it somewhere safe, like a password manager. You can also add an email in Settings for password resets.</p>
    <div class="code">${esc(code)}</div>
    <div class="row" style="margin-top:12px"><button class="btn ghost sm" data-act="copy" data-text="${esc(code)}">${icon('copy', 'sm')}Copy</button><button class="btn ghost sm" data-act="download-code" data-text="${esc(code)}">${icon('download', 'sm')}Download</button></div>
    <label class="check" style="margin-top:18px"><input type="checkbox" id="saved-ok"><span>I’ve saved my recovery code</span></label>
    <div class="acts"><button class="btn primary" id="rc-done" disabled>Continue</button></div>`, { onClose: then });
  $('#saved-ok', m.el).addEventListener('change', e => { $('#rc-done', m.el).disabled = !e.target.checked; });
  $('#rc-done', m.el).addEventListener('click', () => m.close());
}
async function pageSettings(ctx) {
  if (!S.token) return needLogin('/settings');
  if (ctx.q && ctx.q.stripe) {
    try { const st = await gsFn('pay', { action: 'connect_refresh' }); await refreshUnread(); toast(st.ready ? 'Stripe is connected. You can launch projects.' : 'Stripe still needs a few details from you.'); }
    catch (e) { toast(e.message, 'bad'); }
    if (ctx.stale && ctx.stale()) return;
  }
  let blocked = null;
  try { blocked = await rpc('gs_blocks'); } catch (e) { if (e.hint === 'auth') return needLogin('/settings'); }
  if (ctx.stale && ctx.stale()) return;
  const u = S.me, theme = store.get('gs.theme', 'system'), st = u.stripe || {};
  const blockedPanel = blocked ? `<div class="panel" id="blocked"><h2>Blocked accounts</h2>
    ${blocked.length ? blocked.map(b => `<div class="row" style="justify-content:space-between;margin-bottom:12px"><div class="row" style="gap:10px">${avatar(b, 36)}<div><b>${esc(b.name)}</b><div class="muted small">@${esc(b.username)}</div></div></div>
      <button class="btn ghost sm" data-act="unblock" data-username="${esc(b.username)}" data-name="${esc(b.name)}">Unblock</button></div>`).join('')
    : '<p class="muted">You haven’t blocked anyone. To block someone, use Block on one of their comments or on their profile.</p>'}</div>` : '';
  const emailPanel = `<div class="panel" id="email"><h2>Email</h2>
    ${u.email ? `<p>Emails go to <b>${esc(u.email)}</b>. <button class="linkbtn" data-act="email-remove">Remove</button></p>
      <label class="check" style="margin-top:14px"><input type="checkbox" data-setting="email_notify" ${u.email_notify ? 'checked' : ''}><span>Email me about updates, replies and project results</span></label>`
    : u.email_pending ? `<form data-form="email-verify"><p style="margin-bottom:12px">We sent a 6-digit code to <b>${esc(u.email_pending)}</b>.</p>
      <div class="row" style="align-items:flex-end"><label class="field" style="flex:1;margin:0;min-width:160px"><span>Code</span><input class="input" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required></label><button class="btn primary" type="submit">Confirm</button></div>
      <p class="hint"><button type="button" class="linkbtn" data-act="email-resend" data-email="${esc(u.email_pending)}">Send a new code</button></p></form>`
    : `<p class="muted" style="margin-bottom:14px">Add an email to hear from projects you back, and to reset your password if you forget it.</p>
      <form data-form="email-set" class="row" style="align-items:flex-end"><label class="field" style="flex:1;margin:0;min-width:200px"><span>Email</span><input class="input" type="email" name="email" autocomplete="email" required></label><button class="btn primary" type="submit">Send code</button></form>`}
    ${CONF.email ? '' : '<p class="hint">Email isn\u2019t switched on for this site yet, so codes won\u2019t arrive until it is.</p>'}</div>`;
  const payoutsPanel = CONF.stripe || st.connected ? `<div class="panel" id="payouts"><h2>Payouts</h2>
    ${st.ready ? `<p>${icon('check')} Stripe is connected. Money from your funded projects is paid out to your bank by Stripe.</p><div class="row" style="margin-top:12px"><button class="btn ghost" data-act="stripe-dashboard">${icon('ext')}Open Stripe dashboard</button></div>`
    : st.connected ? `<p class="muted" style="margin-bottom:14px">Finish setting up your Stripe account to launch projects and get paid.</p><div class="row"><button class="btn primary" data-act="stripe-connect">Continue Stripe setup</button><button class="btn ghost" data-act="stripe-refresh">I\u2019ve finished</button></div>`
    : `<p class="muted" style="margin-bottom:14px">To launch a project you need a Stripe account. Stripe checks your identity and pays out what you raise to your bank, minus the Groundswell fee of ${CONF.fee_bps / 100}%.</p><button class="btn primary" data-act="stripe-connect">Connect with Stripe</button>`}</div>` : '';
  setMain(`<div class="wrap page narrow"><h1 class="page-title">Settings</h1>
    <div class="panel" style="margin-top:20px"><h2>Profile</h2>
      <form data-form="profile">
        <div class="row" style="margin-bottom:18px">${avatar(u, 72)}<div class="row"><label class="btn ghost sm">${icon('upload', 'sm')}Upload photo<input type="file" accept="image/jpeg,image/png,image/webp" data-upload="avatar" hidden></label>${u.avatar ? '<button type="button" class="btn quiet sm" data-act="avatar-clear">Remove</button>' : ''}</div></div>
        <label class="field"><span>Name</span><input class="input" name="name" maxlength="60" required value="${esc(u.name)}"></label>
        <label class="field"><span>Location <small>optional</small></span><input class="input" name="location" maxlength="80" value="${esc(u.location)}"></label>
        <label class="field"><span>Bio <small>optional</small></span><textarea class="textarea" name="bio" maxlength="600">${esc(u.bio)}</textarea></label>
        <label class="check" style="margin-bottom:18px"><input type="checkbox" name="show_backed" ${u.show_backed ? 'checked' : ''}><span>Show the projects I back on my public profile</span></label>
        <button class="btn primary" type="submit">Save profile</button>
      </form></div>
    ${emailPanel}${payoutsPanel}${blockedPanel}
    <div class="panel"><h2>Help & contact</h2><p class="muted">Questions, a problem with a pledge, or a safety concern? <a href="support.html">Get help or contact us</a>.</p></div>
    <div class="panel"><h2>Appearance</h2><div class="row">${[['system', 'Match device'], ['light', 'Light'], ['dark', 'Dark']].map(([k, v]) => `<button class="chip ${theme === k ? 'on' : ''}" data-act="theme" data-theme="${k}" aria-pressed="${theme === k}">${v}</button>`).join('')}</div></div>
    <div class="panel"><h2>Password</h2>
      <form data-form="password"><label class="field"><span>Current password</span><input class="input" type="password" name="old" autocomplete="current-password" required></label>
      <label class="field"><span>New password</span><input class="input" type="password" name="new" autocomplete="new-password" minlength="8" maxlength="72" required></label>
      <button class="btn primary" type="submit">Change password</button><p class="hint">Signs you out on your other devices.</p></form></div>
    <div class="panel"><h2>Recovery code</h2><p class="muted" style="margin-bottom:14px">Lost your recovery code? Make a new one. The old one stops working.</p>
      <form data-form="recovery" class="row" style="align-items:flex-end"><label class="field" style="flex:1;margin:0;min-width:200px"><span>Password</span><input class="input" type="password" name="password" autocomplete="current-password" required></label><button class="btn ghost" type="submit">New recovery code</button></form></div>
    <div class="panel"><h2>Log out</h2><button class="btn ghost" data-act="logout">${icon('logout')}Log out on this device</button></div>
    <div class="panel"><h2>Delete account</h2><p class="muted" style="margin-bottom:14px">Your live projects are canceled (backers are told), your drafts and active pledges are removed, and your profile is erased. Finished projects stay up for their backers, credited to “Deleted user”.</p>
      <form data-form="delete" class="row" style="align-items:flex-end"><label class="field" style="flex:1;margin:0;min-width:200px"><span>Password</span><input class="input" type="password" name="password" autocomplete="current-password" required></label><button class="btn danger" type="submit">Delete my account</button></form></div>
  </div>`);
}
function pageHow() {
  setMain(`<div class="wrap page narrow"><h1 class="page-title">How Groundswell works</h1>
    <div class="prose" style="margin-top:20px">
      <p>Groundswell helps creators fund new projects with the direct support of the people who want them to exist.</p>
      <h2>All or nothing</h2>
      <p>Every project sets a funding goal and a deadline. If the project reaches its goal by the deadline, every pledge is collected and the creator gets to work. If it falls short, no pledges are collected and nobody pays anything. This protects backers and creators: nobody is left with a half-funded project.</p>
      <h2>For backers</h2>
      <ul><li><b>Pick a reward or pledge any amount.</b> Rewards are the creator’s thank-you: early copies, limited editions, behind-the-scenes access.</li>
        <li><b>Change your mind any time before the deadline.</b> You can raise, lower or cancel your pledge while the campaign is live.</li>
        <li><b>Follow along.</b> Creators post updates, and backers can join the conversation in the comments.</li>
        <li><b>Groundswell isn’t a store.</b> Projects are new ideas, and creators are responsible for delivering what they promise. Read the risks section before you back.</li></ul>
      <h2>For creators</h2>
      <ul><li><b>Draft privately.</b> Write your story, set your goal, and build rewards. Share a private preview link for feedback.</li>
        <li><b>Launch for 1 to 60 days.</b> Your goal and deadline are fixed at launch so backers know exactly what they’re supporting.</li>
        <li><b>Keep backers in the loop.</b> Your dashboard shows funding over time, reward choices and every backer, and lets you post updates.</li></ul>
      ${testSite() ? '<h2>Test mode</h2><p>This Groundswell is running in <b>test mode</b>. Pledges are recorded and count toward goals exactly like real ones, but no card is taken and no money moves. It’s the way to try the whole experience before payments are switched on.</p>'
        : `<h2>Payments</h2><p>Pledges are handled by <b>Stripe</b>. When you back a project you save a card on Stripe’s secure page, and it’s charged only if the project reaches its goal. If a charge fails, you have 7 days to update your card. Creators are paid out by Stripe, minus a ${CONF.fee_bps / 100}% Groundswell fee.</p>`}
      <h2>Trust and safety</h2>
      <p>If a project looks wrong, use <b>Report this project</b> at the bottom of its page. To flag a comment, tap <b>Report</b> under it. Moderators review every report and can remove comments, hide projects and suspend accounts that break the <a href="terms.html">Terms</a>.</p>
      <p>Tap <b>Block</b> on someone’s comment or profile and you won’t see their comments, they can’t comment on your projects, and they can’t send you notifications. Words that aren’t allowed are filtered out of comments, updates, profiles and projects. <a href="support.html">Help & contact</a> has more.</p>
    </div><p style="margin-top:28px"><a class="btn primary" href="#/start">Start a project</a> <a class="btn ghost" href="#/explore">Discover projects</a></p></div>`);
}
function adminSettings(s) {
  return `<div class="panel" style="margin-top:20px"><h2>Payments and email</h2>
    <div class="switch"><div><b>Payments</b><div class="muted small">${s.stripe_ready ? 'Stripe is connected. Projects launched in Real mode take real money.' : 'Add your Stripe keys to switch on real payments (see the README).'}</div></div>
      <div class="row"><button class="chip ${s.payments !== 'stripe' ? 'on' : ''}" data-act="adm-pay" data-mode="test" aria-pressed="${s.payments !== 'stripe'}">Test</button><button class="chip ${s.payments === 'stripe' ? 'on' : ''}" data-act="adm-pay" data-mode="stripe" aria-pressed="${s.payments === 'stripe'}" ${s.stripe_ready ? '' : 'disabled'}>Real (Stripe)</button></div></div>
    <form class="switch" data-form="adm-fee"><div><b>Platform fee</b><div class="muted small">Kept from each successful charge; the rest goes to the creator.</div></div>
      <div class="row"><input class="input" name="fee" inputmode="decimal" style="width:84px" value="${s.fee_bps / 100}" aria-label="Fee percent"><span>%</span><button class="btn ghost sm" type="submit">Save</button></div></form>
    <div class="switch" style="border-bottom:0"><div><b>Email</b><div class="muted small">${s.email_ready ? `Sending through Resend. ${s.emails_queued} queued${s.emails_failed ? `, ${s.emails_failed} failed this week` : ''}.` : 'Add a Resend API key to send email (see the README).'}</div></div><span class="tag ${s.email_ready ? 'good' : ''}">${s.email_ready ? 'On' : 'Off'}</span></div>
    ${s.charges_failed ? `<p class="muted small">${plural(s.charges_failed, 'charge')} waiting for backers to update their card.</p>` : ''}</div>`;
}
function adminWords(s) {
  return `<div class="panel"><h2>Blocked words</h2><p class="muted" style="margin-bottom:14px">Comments, updates, profiles and launched projects can’t include these. Each matches the whole word and common endings (s, ed, ing…), so “class” doesn’t match “ass”.</p>
      <form data-form="adm-words"><label class="field"><span class="sr">Blocked words, one per line</span><textarea class="textarea" name="words" rows="6" spellcheck="false">${esc((s.blocked_words || []).join('\n'))}</textarea></label>
      <button class="btn ghost" type="submit">Save word list</button></form></div>`;
}
function adminReport(r) {
  const c = r.comment, who = c ? c.author : r.project.creator, whoOff = c ? c.author_suspended : r.project.creator_suspended;
  const what = c ? `<div class="small muted">Comment by ${who.username ? `<a href="#/u/${esc(who.username)}">${esc(who.name)}</a>` : esc(who.name)} on <a href="#/p/${r.project.slug}/comments">${esc(r.project.title)}</a></div>
      <div style="margin-top:4px">${c.deleted ? '<span class="muted">(removed)</span>' : `“${esc(c.body)}”`}</div>`
    : `<a href="#/p/${r.project.slug}">${esc(r.project.title)}</a>${r.project.hidden ? ' <span class="tag">Hidden</span>' : ''}`;
  const acts = r.resolved ? '<span class="tag good">Resolved</span>' : `<div class="row" style="gap:6px;flex-wrap:wrap">
      ${c && !c.deleted ? `<button class="btn danger sm" data-act="adm-del-comment" data-id="${r.id}" data-comment="${c.id}">Remove comment</button>` : ''}
      ${who.username && !whoOff ? `<button class="btn ghost sm" data-act="adm-suspend" data-username="${esc(who.username)}" data-on="true">Suspend @${esc(who.username)}</button>` : ''}
      <button class="btn ghost sm" data-act="adm-resolve" data-id="${r.id}">Resolve</button></div>`;
  return `<tr><td style="white-space:normal;min-width:220px">${what}</td><td style="white-space:normal;min-width:200px">${esc(r.reason)}</td><td>${esc(r.by.name)}</td><td>${ago(r.at)}</td><td>${acts}</td></tr>`;
}
async function pageAdmin(ctx) {
  if (!S.token) return needLogin('/admin');
  setMain(loading());
  const d = await rpc('gs_admin');
  if (ctx.stale()) return;
  setMain(`<div class="wrap page"><h1 class="page-title">Moderation</h1>
    <p class="muted">${plural(d.stats.users, 'member')} · ${plural(d.stats.samples, 'sample project')}</p>
    ${adminSettings(d.settings)}
    <div class="panel" style="margin-top:20px"><h2>Reports</h2>${d.reports.length ? `<div class="table-wrap"><table><thead><tr><th>Reported</th><th>Reason</th><th>From</th><th>When</th><th></th></tr></thead><tbody>
      ${d.reports.map(adminReport).join('')}</tbody></table></div>` : '<p class="muted">No reports.</p>'}</div>
    ${(d.suspended || []).length ? `<div class="panel"><h2>Suspended accounts</h2>${d.suspended.map(u => `<div class="row" style="justify-content:space-between;margin-bottom:12px"><div><b>${esc(u.name)}</b> <span class="muted small">@${esc(u.username)} · since ${fmtDate(u.at)}</span></div>
      <button class="btn ghost sm" data-act="adm-suspend" data-username="${esc(u.username)}" data-on="false">Lift suspension</button></div>`).join('')}</div>` : ''}
    ${adminWords(d.settings)}
    <div class="panel"><h2>Projects</h2><div class="table-wrap"><table><thead><tr><th>Project</th><th>Status</th><th>Featured</th><th>Hidden</th></tr></thead><tbody>
      ${d.projects.map(p => `<tr><td><a href="#/p/${p.slug}">${esc(p.title)}</a>${p.sample ? ' <span class="tag">Sample</span>' : ''}</td><td>${esc(p.status)}</td>
        <td><button class="chip ${p.featured ? 'on' : ''}" data-act="adm-set" data-id="${p.id}" data-field="featured" data-on="${!p.featured}">${p.featured ? 'Featured' : 'Feature'}</button></td>
        <td><button class="chip ${p.hidden ? 'on' : ''}" data-act="adm-set" data-id="${p.id}" data-field="hidden" data-on="${!p.hidden}">${p.hidden ? 'Hidden' : 'Hide'}</button></td></tr>`).join('')}</tbody></table></div></div>
    ${d.stats.samples ? `<div class="panel"><h2>Sample projects</h2><p class="muted" style="margin-bottom:14px">Remove the example projects and their sample backers once real projects are live.</p><button class="btn danger" data-act="adm-samples">Remove ${plural(d.stats.samples, 'sample project')}</button></div>` : ''}
  </div>`);
}

const PAGES = {
  '': pageHome, explore: pageExplore, p: pageProject, start: pageStart, edit: pageEdit, dash: pageDash,
  u: pageUser, me: pageMe, activity: pageActivity, settings: pageSettings, how: pageHow, admin: pageAdmin,
  login: ctx => authPage('login', ctx), signup: ctx => authPage('signup', ctx), forgot: ctx => authPage('forgot', ctx),
};

// ------------------------------------------------------------ actions (clicks)
const ACT = {
  retry: () => route(),
  menu: btn => openMenu(btn),
  more: btn => EXPLORE_MORE && EXPLORE_MORE(btn),
  async logout() { const t = S.token; signOutLocal(); go('/'); toast('Logged out'); try { await fetch(`${CFG.url}/rest/v1/rpc/gs_logout`, { method: 'POST', headers: apiHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ p_token: t }) }); } catch { /* offline */ } },
  async save(btn) {
    if (!S.token) return needLogin();
    const on = btn.getAttribute('aria-pressed') !== 'true';
    await busy(btn, async () => {
      await rpc('gs_save', { project: btn.dataset.id, on });
      $$(`[data-act="save"][data-id="${btn.dataset.id}"]`).forEach(b => {
        b.setAttribute('aria-pressed', String(on));
        if (b.classList.contains('btn')) b.innerHTML = icon('bookmark') + (on ? 'Saved' : 'Remind me');
      });
      for (const v of PCACHE.values()) if (v.d.project.id === btn.dataset.id) { v.d.project.saved = on; v.d.me.saved = on; }
      toast(on ? 'Saved. We’ll remind you 48 hours before it ends.' : 'Removed from saved');
    });
  },
  share: btn => share(btn.dataset.title, projectUrl(btn.dataset.slug)),
  'fix-card': btn => busy(btn, () => startCheckout({ pledge: btn.dataset.pledge }, btn.dataset.slug)),
  address: btn => {
    const c = PCACHE.get(btn.dataset.slug), a = (c && c.d.me.address) || {}, f = (k, label, req = true, ac = '') => `<label class="field"><span>${label}${req ? '' : ' <small>optional</small>'}</span><input class="input" name="${k}" ${req ? 'required' : ''} ${ac ? `autocomplete="${ac}"` : ''} value="${esc(a[k] || '')}"></label>`;
    const m = modal(`<h2>Shipping address</h2><p class="muted" style="margin-bottom:14px">Only the creator of this project can see it.</p>
      <form data-form="address" data-id="${btn.dataset.id}" data-slug="${btn.dataset.slug}">${f('name', 'Full name', true, 'name')}${f('line1', 'Street address', true, 'address-line1')}${f('line2', 'Apartment, suite', false, 'address-line2')}
      <div class="grid2">${f('city', 'City', true, 'address-level2')}${f('region', 'Province or state', false, 'address-level1')}</div>
      <div class="grid2">${f('postal', 'Postal code', false, 'postal-code')}${f('country', 'Country', true, 'country-name')}</div>${f('phone', 'Phone (for the courier)', false, 'tel')}
      <div class="acts"><button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" class="btn primary">Save address</button></div></form>`);
    $('form', m.el)._close = m.close;
  },
  async 'survey-send'(btn) {
    if (!await confirmBox('Send the shipping survey?', 'Backers whose reward ships will be asked for their address. You can only send it once.', { ok: 'Send survey' })) return;
    await busy(btn, async () => { const r = await rpc('gs_survey_send', { project: DASH.d.project.id }); DASH.d = await rpc('gs_dashboard', { project: DASH.d.project.id }); toast(`Survey sent to ${plural(r.sent, 'backer')}`); renderDash(DASH.tab); });
  },
  'stripe-connect': btn => busy(btn, async () => { const r = await gsFn('pay', { action: 'connect' }); await openOut(r.url); }),
  'stripe-refresh': btn => busy(btn, async () => { const r = await gsFn('pay', { action: 'connect_refresh' }); await refreshUnread(); toast(r.ready ? 'Stripe is connected.' : 'Stripe still needs a few details from you.'); pageSettings({ q: {} }); }),
  'stripe-dashboard': btn => busy(btn, async () => { const r = await gsFn('pay', { action: 'dashboard' }); await openOut(r.url); }),
  async 'email-remove'(btn) {
    if (!await confirmBox('Remove your email?', 'You\u2019ll stop getting emails, and you\u2019ll need your recovery code to reset your password.', { ok: 'Remove', danger: true })) return;
    await busy(btn, async () => { const r = await rpc('gs_email_remove'); setMe(r.me); pageSettings({ q: {} }); });
  },
  'email-resend': btn => busy(btn, async () => { await rpc('gs_email_set', { email: btn.dataset.email }); toast('New code sent'); }),
  'reset-email': btn => {
    const f = btn.closest('form'), u = f.username.value.trim();
    if (!u) { f.username.focus(); return toast('Enter your username first.', 'bad'); }
    busy(btn, async () => { await rpc('gs_reset_request', { username: u }, { auth: false }); toast(`If @${u} has a confirmed email, a code is on its way.`); f.code.focus(); });
  },
  async 'adm-pay'(btn) {
    const mode = btn.dataset.mode;
    if (mode === 'stripe' && !await confirmBox('Switch on real payments?', 'Projects launched from now on take real money through Stripe. Projects already live stay in test mode.', { ok: 'Switch on' })) return;
    await busy(btn, async () => { await rpc('gs_admin_settings', { patch: { payments: mode } }); await loadConfig(); route(); });
  },
  'copy-preview': btn => copyText(btn.dataset.url, 'Preview link copied'),
  copy: btn => copyText(btn.dataset.text, 'Copied'),
  'download-code': btn => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`Groundswell recovery code\nUsername: ${S.me ? S.me.username : ''}\nCode: ${btn.dataset.text}\n`], { type: 'text/plain' }));
    a.download = 'groundswell-recovery-code.txt'; document.body.append(a); a.click(); a.remove();
  },
  back: (btn, e) => { if (!S.token) { e.preventDefault(); needLogin(btn.getAttribute('href').slice(1)); } else location.hash = btn.getAttribute('href'); },
  report: btn => {
    const m = modal(`<h2>Report this project</h2><p class="muted" style="margin-bottom:14px">Tell the moderators what’s wrong. Reports are private.</p>
      <form data-form="report" data-id="${btn.dataset.id}"><label class="field"><span class="sr">Reason</span><textarea class="textarea" name="reason" maxlength="1000" required placeholder="e.g. This looks copied from another product"></textarea></label>
      <div class="acts"><button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" class="btn primary">Send report</button></div></form>`);
    $('form', m.el)._close = m.close;
  },
  reply: btn => {
    const c = btn.closest('.comment'), slot = $(':scope > .body > .reply-slot', c), th = $('#thread');
    if ($('form', slot)) { slot.innerHTML = ''; return; }
    slot.innerHTML = `<form class="composer" style="margin:12px 0 0" data-form="comment" data-project="${th._ctx.d.project.id}" data-update="${th._ctx.updateId || ''}" data-parent="${btn.dataset.id}"><textarea class="textarea" name="body" maxlength="2000" required placeholder="Write a reply…" aria-label="Reply"></textarea><div class="row"><button class="btn primary sm" type="submit">Reply</button><button class="btn quiet sm" type="button" data-act="reply" data-id="${btn.dataset.id}">Cancel</button></div></form>`;
    $('textarea', slot).focus();
  },
  async 'del-comment'(btn) {
    if (!await confirmBox('Delete this comment?', 'It will be removed for everyone.', { ok: 'Delete', danger: true })) return;
    await busy(btn, async () => { await rpc('gs_comment_delete', { comment: btn.dataset.id }); const th = $('#thread'); if (th && th._ctx) loadThread(th._ctx.d, th._ctx.updateId); });
  },
  'report-comment': btn => {
    const reasons = ['Spam or a scam', 'Harassment, bullying or hate', 'Sexual or violent content', 'Something else'];
    const m = modal(`<h2>Report this comment</h2><p class="muted" style="margin-bottom:14px">The moderators will review it. Reports are private.</p>
      <form data-form="report-comment" data-id="${btn.dataset.id}"><fieldset class="radios" style="border:0;padding:0;margin:0 0 14px"><legend class="sr">Reason</legend>
      ${reasons.map((r, i) => `<label class="check" style="margin-bottom:10px"><input type="radio" name="kind" value="${r}" ${i ? '' : 'checked'}><span>${r}</span></label>`).join('')}</fieldset>
      <label class="field"><span>Details <small>optional</small></span><textarea class="textarea" name="details" maxlength="800"></textarea></label>
      <div class="acts"><button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" class="btn primary">Send report</button></div></form>`);
    $('form', m.el)._close = m.close;
  },
  async block(btn) {
    const name = btn.dataset.name || '@' + btn.dataset.username;
    if (!await confirmBox(`Block ${name}?`, 'You won’t see their comments, they can’t comment on your projects, and they can’t send you notifications. You can unblock them in Settings.', { ok: 'Block', danger: true })) return;
    await busy(btn, async () => {
      await rpc('gs_block', { username: btn.dataset.username, on: true });
      toast(`Blocked ${name}`);
      const th = $('#thread'); if (th && th._ctx) loadThread(th._ctx.d, th._ctx.updateId); else route();
    });
  },
  async unblock(btn) {
    await busy(btn, async () => { await rpc('gs_block', { username: btn.dataset.username, on: false }); toast(`Unblocked ${btn.dataset.name || '@' + btn.dataset.username}`); route(); });
  },
  // pledge flow
  'pl-pick': (el, e) => { if (e.target.closest('input,button')) return; if (PL.sel === el.dataset.id) return; PL.sel = el.dataset.id; PL._scroll = true; renderPledge(); const inp = $(`[data-pl]`); inp && inp.focus({ preventScroll: true }); },
  'pl-next': () => {
    const { d, sel } = PL, cur = d.project.currency;
    if (!sel) return toast('Pick a reward first.', 'bad');
    const inp = $('[data-pl]'), v = inp ? toCents(inp.value || '0') : 0;
    if (v === null) return toast('Enter an amount like 25 or 25.50.', 'bad');
    if (sel === 'none' && v < 100) return toast(`The minimum pledge is ${money(100, cur)}.`, 'bad');
    PL.extra[sel] = v;
    if (plTotal() > 1000000) return toast(`Pledges are limited to ${money(1000000, cur)}.`, 'bad');
    PL.step = 'review'; renderPledge(); window.scrollTo(0, 0);
  },
  'pl-back': () => { PL.step = 'pick'; renderPledge(); },
  async 'pl-cancel'(btn) {
    if (!await confirmBox('Cancel your pledge?', 'You’ll lose your backer number and your reward spot, if it’s limited. You can pledge again while the campaign is live.', { ok: 'Cancel pledge', danger: true })) return;
    await busy(btn, async () => { await rpc('gs_pledge_cancel', { project: PL.d.project.id }); PCACHE.delete(PL.d.project.slug); toast('Your pledge was canceled'); go('/p/' + PL.d.project.slug); });
  },
  // start
  'pick-cat': btn => { $$('.cat-tile').forEach(b => { b.setAttribute('aria-pressed', String(b === btn)); b.setAttribute('aria-checked', String(b === btn)); }); $('form[data-form="start"]').category.value = btn.dataset.cat; },
  // editor
  'cover-shuffle': () => { ED.p.seed = Math.floor(Math.random() * 1e6); $('#drop .cover').innerHTML = art(ED.p.seed, ED.p.category); queueSave({ seed: ED.p.seed }); },
  'cover-clear': () => { ED.p.cover = null; queueSave({ cover: '' }, true); $('#edmain').innerHTML = edStep(); },
  'reward-edit': btn => rewardForm(btn.dataset.id ? ED.p.rewards.find(r => r.id === btn.dataset.id) : null),
  async 'reward-del'(btn) {
    const r = ED.p.rewards.find(x => x.id === btn.dataset.id);
    if (!await confirmBox('Delete this reward?', esc(r ? r.title : ''), { ok: 'Delete', danger: true })) return;
    await busy(btn, async () => { ED.p = await rpc('gs_reward_delete', { reward: btn.dataset.id }); $('#edmain').innerHTML = edStep(); refreshEdChrome(); });
  },
  'item-del': btn => btn.closest('.chip').remove(),
  'faq-add': () => { const box = $('#faqs'); box.insertAdjacentHTML('beforeend', faqRow({ q: '', a: '' }, box.children.length)); $('#faqs .faq-row:last-child input').focus(); },
  'faq-del': btn => { btn.closest('.faq-row').remove(); queueSave({ faqs: collectFaqs() }, true); },
  'faq-move': btn => { const row = btn.closest('.faq-row'), dir = +btn.dataset.dir, sib = dir < 0 ? row.previousElementSibling : row.nextElementSibling; if (!sib) return; dir < 0 ? sib.before(row) : sib.after(row); queueSave({ faqs: collectFaqs() }, true); },
  md: btn => mdOp(btn.closest('.mdwrap'), btn.dataset.mdOp),
  'md-mode': btn => {
    const w = btn.closest('.mdwrap'), ta = $('textarea', w), pv = $('.preview', w), on = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(on)); btn.textContent = on ? 'Write' : 'Preview';
    pv.innerHTML = md(ta.value) || '<p class="muted">Nothing to preview yet.</p>'; pv.hidden = !on; ta.hidden = on;
  },
  async launch(btn) {
    await flushSave();
    const p = ED.p;
    if (!await confirmBox('Launch your project?', `It goes live now and ends ${esc(fmtDateTime(new Date(now() + p.duration * 864e5).toISOString()))}. Your goal of ${esc(money(p.goal, p.currency))} and the duration will be locked.`, { ok: 'Launch now' })) return;
    await busy(btn, async () => { ED.p = await rpc('gs_project_launch', { project: p.id }); PCACHE.delete(p.slug); toast('You’re live! Share your project to get your first backers.'); go('/p/' + ED.p.slug); });
  },
  async 'proj-cancel'(btn) {
    if (!await confirmBox('Cancel this campaign?', 'Backers will be told, no pledges will be collected, and this can’t be undone.', { ok: 'Cancel campaign', danger: true })) return;
    await busy(btn, async () => { ED.p = await rpc('gs_project_cancel', { project: ED.p.id }); PCACHE.delete(ED.p.slug); toast('Campaign canceled'); renderEditor(); });
  },
  async 'proj-delete'(btn) {
    if (!await confirmBox('Delete this draft?', 'The draft and its rewards will be removed for good.', { ok: 'Delete draft', danger: true })) return;
    await busy(btn, async () => { await rpc('gs_project_delete', { project: ED.p.id }); ED = null; toast('Draft deleted'); go('/me/created'); });
  },
  // dashboard
  'dash-tab': btn => renderDash(btn.dataset.tab),
  'dash-table': btn => {
    const t = $('#chart-table'), on = t.hidden; t.hidden = !on; $('#chart').hidden = on; btn.textContent = on ? 'Show as chart' : 'Show as table';
    if (on) t.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Day</th><th class="r">Pledged</th><th class="r">Backers</th></tr></thead><tbody>${DASH.pts.slice().reverse().map(s => `<tr><td>${new Date(s.t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</td><td class="r num">${money(s.pledged, DASH.geo.cur)}</td><td class="r num">${s.backers}</td></tr>`).join('')}</tbody></table></div>`;
  },
  csv: () => csvDownload(),
  'upd-edit': btn => { DASH.editing = btn.dataset.id; renderDash('updates'); window.scrollTo(0, 0); },
  'upd-cancel': () => { DASH.editing = null; renderDash('updates'); },
  async 'upd-del'(btn) {
    if (!await confirmBox('Delete this update?', 'It will be removed for everyone, along with its comments.', { ok: 'Delete', danger: true })) return;
    await busy(btn, async () => { await rpc('gs_update_delete', { update: btn.dataset.id }); DASH.d = await rpc('gs_dashboard', { project: DASH.d.project.id }); PCACHE.delete(DASH.d.project.slug); renderDash('updates'); toast('Update deleted'); });
  },
  // settings
  theme: btn => {
    const t = btn.dataset.theme; store.set('gs.theme', t);
    if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
    $$('[data-act="theme"]').forEach(b => { b.classList.toggle('on', b === btn); b.setAttribute('aria-pressed', String(b === btn)); });
  },
  async 'avatar-clear'(btn) { await busy(btn, async () => { setMe(await rpc('gs_profile_save', { patch: { avatar: '' } })); pageSettings({}); }); },
  // admin
  async 'adm-set'(btn) { await busy(btn, async () => { await rpc('gs_admin_set', { project: btn.dataset.id, field: btn.dataset.field, on: btn.dataset.on === 'true' }); PCACHE.clear(); route(); }); },
  async 'adm-resolve'(btn) { await busy(btn, async () => { await rpc('gs_admin_resolve', { report: +btn.dataset.id }); route(); }); },
  async 'adm-del-comment'(btn) {
    if (!await confirmBox('Remove this comment?', 'It will be removed for everyone, and the report marked resolved.', { ok: 'Remove', danger: true })) return;
    await busy(btn, async () => { await rpc('gs_comment_delete', { comment: btn.dataset.comment }); await rpc('gs_admin_resolve', { report: +btn.dataset.id }); toast('Comment removed'); route(); });
  },
  async 'adm-suspend'(btn) {
    const on = btn.dataset.on === 'true', who = '@' + btn.dataset.username;
    if (on && !await confirmBox(`Suspend ${who}?`, 'They’re signed out everywhere and can’t log in until you lift the suspension. Their projects stay up unless you hide them.', { ok: 'Suspend', danger: true })) return;
    await busy(btn, async () => { await rpc('gs_admin_suspend', { username: btn.dataset.username, on }); toast(on ? `Suspended ${who}` : `Lifted the suspension on ${who}`); route(); });
  },
  async 'adm-samples'(btn) {
    if (!await confirmBox('Remove sample projects?', 'Deletes every sample project, its sample backers, and any test pledges and comments on them.', { ok: 'Remove samples', danger: true })) return;
    await busy(btn, async () => { const r = await rpc('gs_admin_remove_samples'); PCACHE.clear(); toast(`Removed ${plural(r.removed, 'sample project')}`); route(); });
  },
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || !el.dataset.act) return;
  const fn = ACT[el.dataset.act]; if (!fn) return;
  if (el.tagName === 'A' && el.dataset.act !== 'back') return; // links keep their default
  if (!(el.tagName === 'LABEL')) e.preventDefault();
  fn(el, e);
});
document.addEventListener('keydown', e => {
  const el = e.target.closest && e.target.closest('[role="radio"][data-act="pl-pick"]');
  if (el && (e.key === 'Enter' || e.key === ' ') && e.target === el) { e.preventDefault(); ACT['pl-pick'](el, e); }
  if (e.target.matches && e.target.matches('[data-item-input]') && e.key === 'Enter') {
    e.preventDefault(); const v = e.target.value.trim(); if (!v) return;
    if ($$('[data-item]', e.target.parentNode).length >= 12) return toast('Up to 12 items.', 'bad');
    e.target.insertAdjacentHTML('beforebegin', itemChip(v)); e.target.value = '';
  }
});

// ------------------------------------------------------------ forms (submits)
const FORM = {
  search: f => go('/explore?q=' + encodeURIComponent(f.q.value.trim())),
  explore: f => {
    const o = { q: f.q.value.trim(), cat: f.cat.value, state: f.state.value, sort: f.sort.value };
    go('/explore?' + new URLSearchParams(Object.entries(o).filter(([k, v]) => v && !(k === 'state' && v === 'live') && !(k === 'sort' && v === 'magic'))).toString());
  },
  login: f => submitting(f, async () => {
    const r = await rpc('gs_login', { username: f.username.value, password: f.password.value }, { auth: false });
    if (r.error) throw new Error(r.error);
    setSession(r.token, r.me); refreshUnread(); toast(`Welcome back, ${r.me.name}`);
    go(parseHash().q.next || '/');
  }),
  signup: f => submitting(f, async () => {
    const r = await rpc('gs_signup', { username: f.username.value, password: f.password.value, name: f.name.value }, { auth: false });
    setSession(r.token, r.me);
    const next = parseHash().q.next || '/';
    showRecovery(r.recovery, () => { toast(`Welcome to Groundswell, ${r.me.name}!`); go(next); });
  }),
  forgot: f => submitting(f, async () => {
    const r = await rpc('gs_password_reset', { username: f.username.value, code: f.code.value, new: f.password.value }, { auth: false });
    if (r.error) throw new Error(r.error);
    setSession(r.token, r.me);
    const next = parseHash().q.next || '/';
    if (r.recovery) showRecovery(r.recovery, () => { toast('Password reset. You’re logged in.'); go(next); });
    else { toast('Password reset. You’re logged in.'); go(next); }
  }),
  start: f => submitting(f, async () => {
    if (!f.category.value) throw new Error('Pick a category first.');
    const p = await rpc('gs_project_new', { title: f.title.value, category: f.category.value, currency: f.currency.value });
    ED = { p, patch: {}, timer: null, saving: false };
    go(`/edit/${p.id}/basics`);
  }),
  reward: f => submitting(f, async () => {
    const amount = toCents(f.amount.value), ships = f.ships.value === 'yes', shipping = ships ? toCents(f.shipping.value || '0') : 0;
    if (amount === null) throw new Error('Enter the reward amount, like 25.');
    if (shipping === null) throw new Error('Enter a shipping cost, like 8 or 0.');
    const limit = f.limited.checked ? parseInt(f.limit.value, 10) : null;
    if (f.limited.checked && !(limit > 0)) throw new Error('Enter how many are available.');
    const pend = $('[data-item-input]', f).value.trim();
    const items = $$('[data-item]', f).map(c => c.dataset.item).concat(pend ? [pend] : []);
    ED.p = await rpc('gs_reward_save', { project: ED.p.id, reward: { id: f.dataset.id || null, title: f.title.value, amount, description: f.description.value, items, ships, shipping, est_delivery: f.est_delivery.value || null, limit } });
    PCACHE.delete(ED.p.slug); f._close(); $('#edmain').innerHTML = edStep(); refreshEdChrome(); toast('Reward saved');
  }),
  pledge: f => submitting(f, async () => {
    const { d, sel } = PL;
    const r = await rpc('gs_pledge', { project: d.project.id, reward: sel === 'none' ? null : sel, amount: plTotal() });
    if (r.needs_card) { await startCheckout({ intent: r.intent }, d.project.slug); return; }
    PCACHE.delete(d.project.slug);
    if (PL.mine) { toast('Your pledge was updated'); go('/p/' + d.project.slug); return; }
    THANKS = { slug: d.project.slug, project: r.project, pledge: r.pledge };
    go(`/p/${d.project.slug}/thanks`);
  }),
  comment: f => submitting(f, async () => {
    await rpc('gs_comment_post', { project: f.dataset.project, update: f.dataset.update || null, parent: f.dataset.parent || null, body: f.body.value });
    const th = $('#thread'); f.reset();
    const c = PCACHE.get(th._ctx.d.project.slug); if (c && !f.dataset.update) c.d.project.comments++;
    await loadThread(th._ctx.d, th._ctx.updateId); toast('Comment posted');
  }),
  report: f => submitting(f, async () => { await rpc('gs_report', { project: f.dataset.id, reason: f.reason.value }); f._close(); toast('Thanks. The moderators will take a look.'); }),
  'report-comment': f => submitting(f, async () => {
    const details = f.details.value.trim();
    await rpc('gs_comment_report', { comment: f.dataset.id, reason: f.kind.value + (details ? ': ' + details : '') });
    f._close(); toast('Thanks. The moderators will take a look.');
  }),
  'adm-words': f => submitting(f, async () => { await rpc('gs_admin_words', { words: f.words.value }); toast('Word list saved'); route(); }),
  update: f => submitting(f, async () => {
    const p = DASH.d.project;
    await rpc('gs_update_post', { project: p.id, id: f.dataset.id || null, title: f.title.value, body: $('textarea[data-field="body"]', f).value, backers_only: f.backers_only.checked });
    toast(f.dataset.id ? 'Update saved' : 'Update posted. Your backers have been notified.');
    DASH.editing = null; DASH.d = await rpc('gs_dashboard', { project: p.id }); PCACHE.delete(p.slug); renderDash('updates');
  }),
  address: f => submitting(f, async () => {
    const a = Object.fromEntries(['name', 'line1', 'line2', 'city', 'region', 'postal', 'country', 'phone'].map(k => [k, f[k].value]));
    await rpc('gs_address_save', { project: f.dataset.id, address: a });
    f._close(); PCACHE.delete(f.dataset.slug); toast('Address saved'); route();
  }),
  'email-set': f => submitting(f, async () => { await rpc('gs_email_set', { email: f.email.value }); await refreshUnread(); toast('Code sent. Check your email.'); pageSettings({ q: {} }); }),
  'email-verify': f => submitting(f, async () => {
    const r = await rpc('gs_email_verify', { code: f.code.value });
    if (r.error) throw new Error(r.error);
    setMe(r.me); toast('Email confirmed'); pageSettings({ q: {} });
  }),
  'adm-fee': f => submitting(f, async () => {
    const pct = parseFloat(String(f.fee.value).replace(',', '.'));
    if (!Number.isFinite(pct)) throw new Error('Enter a percentage, like 8.');
    await rpc('gs_admin_settings', { patch: { fee_bps: Math.round(pct * 100) } }); await loadConfig(); toast('Fee saved'); route();
  }),
  profile: f => submitting(f, async () => { setMe(await rpc('gs_profile_save', { patch: { name: f.name.value, location: f.location.value, bio: f.bio.value, show_backed: f.show_backed.checked } })); toast('Profile saved'); }),
  password: f => submitting(f, async () => { await rpc('gs_password_change', { old: f.old.value, new: f.new.value }); f.reset(); toast('Password changed'); }),
  recovery: f => submitting(f, async () => { const r = await rpc('gs_recovery_new', { password: f.password.value }); f.reset(); showRecovery(r.recovery, () => toast('New recovery code saved')); }),
  delete: f => submitting(f, async () => {
    if (!await confirmBox('Delete your account?', 'This can’t be undone.', { ok: 'Delete account', danger: true })) return;
    await rpc('gs_account_delete', { password: f.password.value }); signOutLocal(); go('/'); toast('Your account was deleted');
  }),
};
document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-form]'); if (!f) return;
  e.preventDefault(); const fn = FORM[f.dataset.form]; fn && fn(f, e);
});

// ------------------------------------------------------------ live inputs (editor autosave, pledge totals)
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.pl !== undefined && PL) {
    const v = toCents(t.value || '0'); if (v !== null) PL.extra[PL.sel] = v;
    const out = $('#pl-total'); if (out) out.textContent = money(plTotal(), PL.d.project.currency);
    return;
  }
  if (!ED) return;
  const f = t.dataset.field;
  if (t.closest('form[data-form="update"]')) return;
  if (f) {
    const cnt = $(`[data-count="${f}"]`); if (cnt) cnt.textContent = f === 'duration' ? t.value : t.value.length;
    if (f === 'goal') { const c = toCents(t.value); if (c !== null) queueSave({ goal_cents: c }); return; }
    if (f === 'duration') { const n = +t.value; queueSave({ duration_days: n }); const h = $('#ends'); if (h) h.textContent = `If you launch today, it ends ${fmtDate(new Date(now() + n * 864e5).toISOString())}. Campaigns of 30 days or less tend to do best.`; return; }
    if (['title', 'blurb', 'location', 'video', 'story', 'risks'].includes(f)) queueSave({ [f]: t.value });
  }
  if (t.matches('[data-faq-q],[data-faq-a]')) queueSave({ faqs: collectFaqs() });
});
document.addEventListener('change', async e => {
  const t = e.target;
  if (t.dataset.upload) {
    const file = t.files && t.files[0]; t.value = '';
    if (!file) return;
    const kind = t.dataset.upload, lbl = t.closest('label');
    await busy(lbl, async () => {
      const path = await uploadImage(file, kind);
      if (kind === 'cover') { ED.p.cover = path; queueSave({ cover: path }, true); $('#edmain').innerHTML = edStep(); }
      else if (kind === 'avatar') { setMe(await rpc('gs_profile_save', { patch: { avatar: path } })); pageSettings({}); toast('Photo updated'); }
      else { insertAtCursor($('textarea', t.closest('.mdwrap')), `![](${MEDIA + path})`); }
    });
    return;
  }
  if (t.tagName === 'SELECT' && t.form && t.form.dataset.form === 'explore') { FORM.explore(t.form); return; }
  if (t.dataset.setting === 'email_notify') { try { setMe(await rpc('gs_profile_save', { patch: { email_notify: t.checked } })); toast(t.checked ? 'Emails on' : 'Emails off'); } catch (e) { toast(e.message, 'bad'); } return; }
  if (!ED) return;
  if (t.dataset.field === 'category') queueSave({ category: t.value }, true);
  if (t.dataset.field === 'currency') { queueSave({ currency: t.value }, true); ED.p.currency = t.value; const s = $('[data-sym]'); if (s) s.textContent = curSymbol(t.value); }
  if (t.dataset.field === 'goal') { const c = toCents(t.value); if (c === null) toast('Enter a goal like 5000.', 'bad'); else queueSave({ goal_cents: c }, true); }
  if (['title', 'blurb', 'location', 'video', 'story', 'risks'].includes(t.dataset.field)) flushSave();
});
// Cover drag and drop
document.addEventListener('dragover', e => { const z = e.target.closest && e.target.closest('#drop'); if (z) { e.preventDefault(); z.classList.add('drag'); } });
document.addEventListener('dragleave', e => { const z = e.target.closest && e.target.closest('#drop'); if (z) z.classList.remove('drag'); });
document.addEventListener('drop', async e => {
  const z = e.target.closest && e.target.closest('#drop'); if (!z) return;
  e.preventDefault(); z.classList.remove('drag');
  const file = e.dataTransfer.files && e.dataTransfer.files[0]; if (!file || !ED) return;
  await busy($('label', z), async () => { const path = await uploadImage(file, 'cover'); ED.p.cover = path; queueSave({ cover: path }, true); $('#edmain').innerHTML = edStep(); });
});
window.addEventListener('beforeunload', e => { if (ED && Object.keys(ED.patch).length) { flushSave(); e.preventDefault(); } });

// ------------------------------------------------------------ boot
async function refreshUnread() {
  if (!S.token) return;
  try { const r = await rpc('gs_me'); S.unread = r.unread; setMe(r.me); } catch { /* signed out or offline */ }
}
window.addEventListener('hashchange', route);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshUnread(); });
setInterval(() => { if (!document.hidden) refreshUnread(); }, 60000);
window.addEventListener('offline', () => { if (!$('.offline')) document.body.insertAdjacentHTML('beforeend', '<div class="offline" role="status">You’re offline</div>'); });
window.addEventListener('online', () => { const o = $('.offline'); if (o) o.remove(); });
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
async function loadConfig() {
  try { const c = await rpc('gs_config', {}, { auth: false }); const changed = c.payments !== CONF.payments || c.stripe !== CONF.stripe || c.email !== CONF.email; CONF = { ...CONF, ...c }; renderChrome(); return changed; }
  catch { return false; }
}
if (NATIVE && PLUG.App) PLUG.App.addListener('appUrlOpen', e => {
  // groundswell://return?to=/p/slug/paid&session=... from return-app.html
  try {
    const u = new URL(e.url), to = u.searchParams.get('to') || '/', session = u.searchParams.get('session');
    if (PLUG.Browser) PLUG.Browser.close().catch(() => {});
    if (to.startsWith('/') && !to.startsWith('//')) go(to + (session ? (to.includes('?') ? '&' : '?') + 'session=' + encodeURIComponent(session) : ''));
  } catch { /* ignore malformed links */ }
});
if (NATIVE && PLUG.Browser) PLUG.Browser.addListener('browserFinished', () => {
  const p = store.get('gs.paying');
  if (p && p.intent && p.slug && Date.now() - p.at < 3600e3) go(`/p/${p.slug}/paid?intent=${p.intent}`);
  else { PCACHE.clear(); route(); }
});
renderChrome();
route();
refreshUnread();
loadConfig().then(changed => { if (changed && /^#\/(settings|how|admin|edit|p\/[^/]+\/pledge)/.test(location.hash)) route(); });
window.__gs = { S, md, art, money, toCents, timeLeft, PCACHE, conf: () => CONF }; // used by the browser tests
})();
