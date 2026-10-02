/* Forus Tempo: servidor de avisos (Cloudflare Worker).
 *
 * Guarda, por dispositivo, su suscripción push y las tareas pendientes con fecha,
 * y cada 15 minutos envía los avisos que tocan:
 *   - la tarde anterior («Mañana vence…»)
 *   - la mañana del día («Hoy vence…»)
 *
 * Necesita un espacio KV enlazado como SUBS. Las claves VAPID se crean solas
 * la primera vez y se guardan en ese KV.
 */

const ALLOWED_ORIGINS = ['https://hugocamara7.github.io', 'http://localhost:8765'];
const VAPID_SUBJECT = 'https://hugocamara7.github.io/forus-tempo/';
const APP_URL = 'https://hugocamara7.github.io/forus-tempo/';
const SEND_WINDOW_MIN = 120; // tras la hora elegida, margen para enviar si el cron se retrasa
const MAX_TASKS = 300;

/* ---------- utilidades ---------- */
const enc = new TextEncoder();
function b64u(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64u(str) {
  const s = atob(String(str).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
function concat(...parts) {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const isYmd = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isHm = v => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const toMin = hm => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/* Fecha y minuto del día en la zona horaria del dispositivo. */
function localNow(tz, now) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  } catch (e) {
    parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  }
  const g = t => parts.find(p => p.type === t).value;
  return { date: g('year') + '-' + g('month') + '-' + g('day'), min: Number(g('hour')) * 60 + Number(g('minute')) };
}

/* ---------- claves VAPID ---------- */
let vapidCache = null;
async function getVapid(env) {
  if (vapidCache) return vapidCache;
  let stored = await env.SUBS.get('vapid', 'json');
  if (!stored) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
    const pub = b64u(await crypto.subtle.exportKey('raw', kp.publicKey));
    stored = { jwk, pub };
    await env.SUBS.put('vapid', JSON.stringify(stored));
  }
  const key = await crypto.subtle.importKey('jwk', stored.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  vapidCache = { key, pub: stored.pub };
  return vapidCache;
}
async function vapidAuth(env, endpoint) {
  const v = await getVapid(env);
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 3600, sub: VAPID_SUBJECT })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, v.key, enc.encode(head + '.' + body));
  return 'vapid t=' + head + '.' + body + '.' + b64u(sig) + ', k=' + v.pub;
}

/* ---------- cifrado de la notificación (RFC 8291, aes128gcm) ---------- */
async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}
export async function encryptPayload(sub, payload) {
  const uaPub = unb64u(sub.keys.p256dh);
  const auth = unb64u(sub.keys.auth);
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(auth, shared, concat(enc.encode('WebPush: info\0'), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const plain = concat(enc.encode(payload), new Uint8Array([2]));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plain));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return concat(salt, rs, new Uint8Array([asPub.length]), asPub, cipher);
}

/* Envía un aviso. Devuelve el código HTTP del servicio push. */
async function sendPush(env, sub, msg) {
  const body = await encryptPayload(sub, JSON.stringify(msg));
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuth(env, sub.endpoint),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '43200',
      Urgency: 'high'
    },
    body
  });
  return res.status;
}

/* ---------- qué avisar ---------- */
function list(titles) {
  const shown = titles.slice(0, 4).join(' · ');
  return titles.length > 4 ? shown + ' y ' + (titles.length - 4) + ' más' : shown;
}
export function buildMessage(kind, tasks, date) {
  if (kind === 'eve') {
    const t = tasks.filter(x => x.d === addDays(date, 1)).map(x => x.t);
    if (!t.length) return null;
    return t.length === 1
      ? { title: 'Mañana vence: ' + t[0], body: 'Toca para verla en Forus Tempo.', tag: 'ft-eve-' + date }
      : { title: t.length + ' tareas vencen mañana', body: list(t), tag: 'ft-eve-' + date };
  }
  const t = tasks.filter(x => x.d === date).map(x => x.t);
  const late = tasks.filter(x => x.d < date).map(x => x.t);
  const lateTxt = late.length === 1 ? '1 tarea vencida' : late.length + ' tareas vencidas';
  const tag = 'ft-mor-' + date;
  if (!t.length && !late.length) return null;
  if (!t.length) return { title: 'Tienes ' + lateTxt, body: list(late), tag };
  if (t.length === 1) return { title: 'Hoy vence: ' + t[0], body: late.length ? 'Además tienes ' + lateTxt + '.' : 'Toca para verla en Forus Tempo.', tag };
  return { title: t.length + ' tareas vencen hoy', body: list(t) + (late.length ? '. Además tienes ' + lateTxt + '.' : ''), tag };
}

/* Revisa un dispositivo y envía lo que toque. Devuelve el registro (cambiado o no) o null si hay que borrarlo. */
export async function checkDevice(env, rec, now, send) {
  const { date, min } = localNow(rec.tz, now);
  for (const kind of ['eve', 'mor']) {
    const p = rec.prefs[kind];
    if (!p || !p.on) continue;
    const at = toMin(p.time);
    const key = date + '|' + kind;
    if (rec.sent[key] || min < at || min >= at + SEND_WINDOW_MIN) continue;
    rec.sent[key] = Date.now();
    const msg = buildMessage(kind, rec.tasks, date);
    if (!msg) continue;
    msg.url = APP_URL;
    msg.badge = rec.tasks.filter(x => x.d <= date).length;
    const status = await send(env, rec.sub, msg);
    if (status === 404 || status === 410) return null;
  }
  for (const k of Object.keys(rec.sent)) {
    if (k.slice(0, 10) < addDays(date, -3)) delete rec.sent[k];
  }
  return rec;
}

/* ---------- validación ---------- */
function cleanSub(s) {
  if (!s || typeof s.endpoint !== 'string' || !/^https:\/\//.test(s.endpoint) || s.endpoint.length > 1000) return null;
  if (!s.keys || typeof s.keys.p256dh !== 'string' || typeof s.keys.auth !== 'string') return null;
  if (s.keys.p256dh.length > 200 || s.keys.auth.length > 100) return null;
  return { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } };
}
function cleanPrefs(p) {
  p = p || {};
  const one = (x, def) => ({ on: x ? x.on !== false : true, time: x && isHm(x.time) ? x.time : def });
  return { eve: one(p.eve, '18:00'), mor: one(p.mor, '08:00') };
}
function cleanTasks(t) {
  return (Array.isArray(t) ? t : []).filter(x => x && isYmd(x.d) && typeof x.t === 'string').slice(0, MAX_TASKS)
    .map(x => ({ t: x.t.slice(0, 120), d: x.d }));
}
const validId = v => typeof v === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(v);

/* ---------- HTTP ---------- */
function cors(req) {
  const o = req.headers.get('Origin');
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(o) ? o : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}
const json = (req, data, status) => new Response(JSON.stringify(data), { status: status || 200, headers: { 'Content-Type': 'application/json', ...cors(req) } });

async function handle(req, env) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  const path = new URL(req.url).pathname;

  if (req.method === 'GET' && path === '/vapid') return json(req, { key: (await getVapid(env)).pub });
  if (req.method === 'GET' && path === '/') return json(req, { ok: true, app: 'forus-tempo-push' });
  if (req.method !== 'POST') return json(req, { error: 'not_found' }, 404);

  const text = await req.text();
  if (text.length > 100000) return json(req, { error: 'too_big' }, 413);
  let b;
  try { b = JSON.parse(text); } catch (e) { return json(req, { error: 'bad_json' }, 400); }
  if (!b || !validId(b.id) || !validId(b.secret)) return json(req, { error: 'bad_id' }, 400);

  const key = 'dev:' + b.id;
  const old = await env.SUBS.get(key, 'json');
  if (old && old.secret !== b.secret) return json(req, { error: 'forbidden' }, 403);

  if (path === '/sync') {
    const sub = cleanSub(b.sub);
    if (!sub) return json(req, { error: 'bad_sub' }, 400);
    const rec = {
      secret: b.secret, sub,
      tz: typeof b.tz === 'string' ? b.tz.slice(0, 64) : 'UTC',
      prefs: cleanPrefs(b.prefs),
      tasks: cleanTasks(b.tasks),
      sent: old ? old.sent || {} : {},
      updated: Date.now()
    };
    await env.SUBS.put(key, JSON.stringify(rec));
    return json(req, { ok: true });
  }
  if (path === '/unsubscribe') {
    if (old) await env.SUBS.delete(key);
    return json(req, { ok: true });
  }
  if (path === '/test') {
    if (!old) return json(req, { error: 'unknown_device' }, 404);
    const status = await sendPush(env, old.sub, { title: 'Forus Tempo', body: '¡Listo! Así te llegarán los avisos de tus tareas.', tag: 'ft-test', url: APP_URL });
    if (status === 404 || status === 410) { await env.SUBS.delete(key); return json(req, { error: 'expired' }, 410); }
    return json(req, { ok: status < 300, status });
  }
  return json(req, { error: 'not_found' }, 404);
}

async function runCron(env, now) {
  let cursor;
  do {
    const page = await env.SUBS.list({ prefix: 'dev:', cursor });
    for (const k of page.keys) {
      const rec = await env.SUBS.get(k.name, 'json');
      if (!rec) continue;
      const before = JSON.stringify(rec.sent);
      let out;
      try { out = await checkDevice(env, rec, now, sendPush); } catch (e) { continue; }
      if (out === null) await env.SUBS.delete(k.name);
      else if (JSON.stringify(out.sent) !== before) await env.SUBS.put(k.name, JSON.stringify(out));
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
}

export default {
  async fetch(req, env) {
    try { return await handle(req, env); }
    catch (e) { return json(req, { error: 'server' }, 500); }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCron(env, new Date(event.scheduledTime)));
  }
};
