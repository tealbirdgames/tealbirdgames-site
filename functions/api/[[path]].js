// Vapura Yetiş / Ferry Tales — arkadaşla meydan okuma API'si (Cloudflare Pages Functions + D1)
// POST /api/ch            {L, nick, pid}                     -> {id}
// GET  /api/ch/:id                                           -> {id, L, by, rows:[...]}
// POST /api/ch/:id/res    {pid, nick, won, sec, used, pct}   -> {id, L, by, rows:[...], me}
// Kaptanlar Tablosu (v1.55): en yüksek bölüm sıralaması
// GET  /api/lb?pid=                                         -> {n, top:[{p,nick,lvl}], me:{rank,lvl,nick}|null, near:[...]}
// POST /api/lb            {pid, nick, lvl, stars, plat}      -> aynı tablo
// POST /api/lb/del        {pid}                              -> {ok}  (oyuncu tablodan çıkmak isterse)
// POST /api/lb/report     {pid, p}                           -> {ok}  (p: şikâyet edilen oyuncunun kısa kimliği; 3 farklı şikâyette takma ad otomatiğe döner)
// v1.58 Pano: POST /api/oynama, /api/oynama-sil (yalnız oynanış verisine izin veren oyuncular) · GET /api/pano-* (x-pano-anahtar; PANO_ANAHTAR gizli ortam değişkeni)
import { panoIsle, PANO_YOLLARI } from '../_pano/pano.mjs';
import { semaKur } from '../_pano/sema.mjs';
import { oynamaYaz, oynamaSil } from '../_pano/oynama.mjs';
import { adGecmisYaz } from '../_pano/adgecmis.mjs';

const H = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
};
const j = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: H });
const bad = (m, s = 400) => j({ error: m }, s);

const ABC = 'abcdefghjkmnpqrstuvwxyz23456789';
function newId(n = 8) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  let s = '';
  for (const x of b) s += ABC[x % ABC.length];
  return s;
}
const okId = (s) => typeof s === 'string' && /^[a-z0-9]{6,12}$/.test(s);
const okPid = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{8,40}$/.test(s);
function cleanNick(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/[\u0000-\u001f<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
}
const int = (v, lo, hi) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};
// Düşük skor daha iyi: kazananlar süre + güçlendirici cezası (her biri 10 sn); kaybedenler ilerlemeye göre sona.
const scoreOf = (won, sec, used, pct) => (won ? sec + used * 10 : 1000000 - pct);

async function board(db, id) {
  const ch = await db.prepare('SELECT id, L, by_nick FROM ch WHERE id = ?').bind(id).first();
  if (!ch) return null;
  const { results } = await db
    .prepare('SELECT pid, nick, won, sec, used, pct, tries FROM res WHERE cid = ? ORDER BY score ASC, updated ASC LIMIT 50')
    .bind(id)
    .all();
  return {
    id: ch.id,
    L: ch.L,
    by: ch.by_nick,
    rows: results.map((r) => ({ p: r.pid.slice(0, 6), nick: r.nick, won: !!r.won, sec: r.sec, used: r.used, pct: r.pct, tries: r.tries })),
  };
}

// ---------- Kaptanlar Tablosu ----------
const BAD = /(^|[^a-zçğıöşü])(amk|aq(?![a-z])|orospu|oç|piç|sik|yarra|göt|amcık|amcik|ibne|kahpe|pezevenk)|fuck|shit|bitch|cunt|nigg|faggot|porn|hitler|nazi/i;
const autoNick = (pid) => 'Kaptan ' + (1000 + (parseInt(pid.slice(-6).replace(/[^0-9a-f]/gi, '0'), 16) % 9000));
// LB_MAX: oyundaki son bölüm + pay (yeni şehir eklenince artır). İlk kayıtta da bunun üstü sayılmaz.
const LB_MAX = 150, LB_FIRST = 150;
const REP_LIMIT = 3;
let repReady = false;
async function repInit(db) {
  if (repReady) return;
  await db.prepare('CREATE TABLE IF NOT EXISTS lb_rep (target TEXT NOT NULL, reporter TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (target, reporter))').run();
  repReady = true;
}
async function repCount(db, pid) {
  await repInit(db);
  const r = await db.prepare('SELECT COUNT(*) AS n FROM lb_rep WHERE target = ?').bind(pid).first();
  return r ? r.n : 0;
}
const rowOut = (r) => ({ p: r.pid.slice(0, 6), nick: r.nick, lvl: r.lvl });

async function lbBoard(db, pid) {
  const { results: top } = await db.prepare('SELECT pid, nick, lvl FROM lb ORDER BY lvl DESC, reached ASC LIMIT 50').all();
  const cnt = await db.prepare('SELECT COUNT(*) AS n FROM lb').first();
  const o = { n: cnt ? cnt.n : 0, top: top.map(rowOut), me: null, near: [] };
  if (!pid) return o;
  const me = await db.prepare('SELECT pid, nick, lvl, reached FROM lb WHERE pid = ?').bind(pid).first();
  if (!me) return o;
  const ab = await db.prepare('SELECT COUNT(*) AS n FROM lb WHERE lvl > ? OR (lvl = ? AND reached < ?)').bind(me.lvl, me.lvl, me.reached).first();
  const rank = (ab ? ab.n : 0) + 1;
  o.me = { p: pid.slice(0, 6), rank, lvl: me.lvl, nick: me.nick };
  if (rank > 50) {
    const { results: up } = await db
      .prepare('SELECT pid, nick, lvl FROM lb WHERE lvl > ? OR (lvl = ? AND reached < ?) ORDER BY lvl ASC, reached DESC LIMIT 2')
      .bind(me.lvl, me.lvl, me.reached).all();
    const { results: dn } = await db
      .prepare('SELECT pid, nick, lvl FROM lb WHERE lvl < ? OR (lvl = ? AND reached > ?) ORDER BY lvl DESC, reached ASC LIMIT 2')
      .bind(me.lvl, me.lvl, me.reached).all();
    o.near = [
      ...up.reverse().map((r, k) => ({ ...rowOut(r), rank: rank - up.length + k })),
      { ...rowOut(me), rank },
      ...dn.map((r, k) => ({ ...rowOut(r), rank: rank + 1 + k })),
    ];
  }
  return o;
}

async function lbRoute(db, request, parts) {
  if (parts.length === 1 && request.method === 'GET') {
    const pid = new URL(request.url).searchParams.get('pid');
    return j(await lbBoard(db, okPid(pid) ? pid : null));
  }
  const b = await request.json().catch(() => ({}));
  if (!okPid(b.pid)) return bad('geçersiz');
  if (parts.length === 2 && parts[1] === 'del' && request.method === 'POST') {
    await db.prepare('DELETE FROM lb WHERE pid = ?').bind(b.pid).run();
    return j({ ok: true });
  }
  if (parts.length === 2 && parts[1] === 'report' && request.method === 'POST') {
    const p = typeof b.p === 'string' && /^[A-Za-z0-9_-]{6}$/.test(b.p) ? b.p : null;
    if (!p || b.pid.slice(0, 6) === p) return bad('geçersiz');
    const t = await db.prepare("SELECT pid FROM lb WHERE substr(pid, 1, 6) = ? LIMIT 1").bind(p).first();
    if (!t) return j({ ok: true });
    await repInit(db);
    await db.prepare('INSERT OR IGNORE INTO lb_rep (target, reporter, at) VALUES (?, ?, ?)').bind(t.pid, b.pid, Date.now()).run();
    if ((await repCount(db, t.pid)) >= REP_LIMIT)
      await db.prepare('UPDATE lb SET nick = ? WHERE pid = ?').bind(autoNick(t.pid), t.pid).run();
    return j({ ok: true });
  }
  if (parts.length !== 1 || request.method !== 'POST') return bad('yok', 404);
  let nick = cleanNick(b.nick);
  if (!nick || BAD.test(nick) || (await repCount(db, b.pid)) >= REP_LIMIT) nick = autoNick(b.pid);
  let lvl = int(b.lvl, 0, 100000);
  if (lvl !== null) lvl = Math.min(lvl, LB_MAX);
  const st = int(b.stars, 0, 100000) || 0;
  const plat = ['ios', 'android', 'web'].includes(b.plat) ? b.plat : 'web';
  if (lvl === null) return bad('geçersiz');
  const now = Date.now();
  const old = await db.prepare('SELECT lvl, updated, nick FROM lb WHERE pid = ?').bind(b.pid).first();
  if (old && old.nick !== nick) { try { await semaKur(db); await adGecmisYaz(db, b.pid, old.nick, nick, now); } catch (e) {} }
  if (!old) {
    lvl = Math.min(lvl, LB_FIRST);
    await db
      .prepare('INSERT INTO lb (pid, nick, lvl, stars, plat, created, updated, reached) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(b.pid, nick, lvl, st, plat, now, now, now).run();
  } else {
    // hile koruması: bir bölüm en az ~20 sn sürer; aradaki süreden fazlası sayılmaz
    const cap = old.lvl + 1 + Math.floor((now - old.updated) / 20000);
    lvl = Math.min(lvl, cap);
    if (lvl > old.lvl) {
      await db.prepare('UPDATE lb SET nick = ?, lvl = ?, stars = ?, plat = ?, updated = ?, reached = ? WHERE pid = ?')
        .bind(nick, lvl, st, plat, now, now, b.pid).run();
    } else {
      await db.prepare('UPDATE lb SET nick = ?, stars = ?, plat = ?, updated = ? WHERE pid = ?')
        .bind(nick, st, plat, now, b.pid).run();
    }
  }
  return j(await lbBoard(db, b.pid));
}

export async function onRequest({ request, env, params }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: H });
  const db = env.DB;
  if (!db) return bad('db yok', 500);
  const parts = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  const yol = '/api/' + parts.join('/');
  if (PANO_YOLLARI.includes(yol)) {      // pano: yalnız okur, aynı kökenden çağrılır (CORS yok)
    const PH = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex, nofollow' };
    const baslik = {}; request.headers.forEach((v, k) => { baslik[k.toLowerCase()] = v; });
    const ayar = { panoAnahtar: env.PANO_ANAHTAR || '', yoneticiAnahtar: '', bolumSayisi: Number(env.BOLUM_SAYISI) || 120, saklamaGun: 180, reklam: { bagli: false, eksik: ['APPLE_ADS_*'] } };
    try {
      await semaKur(db);
      const o = await panoIsle({ yontem: request.method, yol, sorgu: Object.fromEntries(new URL(request.url).searchParams), baslik }, db, ayar, Date.now());
      return new Response(JSON.stringify(o.govde), { status: o.durum, headers: PH });
    } catch (e) { return new Response(JSON.stringify({ ok: false, hata: 'sunucu', mesaj: 'Sunucu hatası.' }), { status: 500, headers: PH }); }
  }

  try {
    if (parts[0] === 'lb') return await lbRoute(db, request, parts);
    if ((parts[0] === 'oynama' || parts[0] === 'oynama-sil') && parts.length === 1 && request.method === 'POST') {
      const ct = Number(request.headers.get('content-length') || 0); if (ct > 16000) return bad('büyük', 413);
      const b = await request.json().catch(() => null);
      await semaKur(db);
      const o = parts[0] === 'oynama' ? await oynamaYaz(db, b, (request.cf && request.cf.country) || null, Date.now()) : await oynamaSil(db, b);
      return j(o.govde, o.durum);
    }

    // POST /api/ch
    if (parts.length === 1 && parts[0] === 'ch' && request.method === 'POST') {
      const b = await request.json().catch(() => ({}));
      const L = int(b.L, 2, 500), nick = cleanNick(b.nick);
      if (!L || !nick || !okPid(b.pid)) return bad('geçersiz');
      // aynı oyuncu çok sık oluşturmasın (dakikada 10)
      const since = Date.now() - 60000;
      const c = await db.prepare('SELECT COUNT(*) AS n FROM ch WHERE by_pid = ? AND created > ?').bind(b.pid, since).first();
      if (c && c.n >= 10) return bad('çok sık', 429);
      let id = newId();
      for (let k = 0; k < 3; k++) {
        const ex = await db.prepare('SELECT 1 FROM ch WHERE id = ?').bind(id).first();
        if (!ex) break;
        id = newId();
      }
      await db.prepare('INSERT INTO ch (id, L, by_pid, by_nick, created) VALUES (?, ?, ?, ?, ?)').bind(id, L, b.pid, nick, Date.now()).run();
      return j({ id, L });
    }

    if (parts[0] === 'ch' && okId(parts[1])) {
      const id = parts[1];
      // GET /api/ch/:id
      if (parts.length === 2 && request.method === 'GET') {
        const o = await board(db, id);
        return o ? j(o) : bad('bulunamadı', 404);
      }
      // POST /api/ch/:id/res
      if (parts.length === 3 && parts[2] === 'res' && request.method === 'POST') {
        const b = await request.json().catch(() => ({}));
        const nick = cleanNick(b.nick), won = b.won ? 1 : 0;
        const sec = int(b.sec, won ? 3 : 0, 7200), used = int(b.used, 0, 99), pct = int(b.pct, 0, 100);
        if (!nick || !okPid(b.pid) || sec === null || used === null || pct === null) return bad('geçersiz');
        const ch = await db.prepare('SELECT 1 FROM ch WHERE id = ?').bind(id).first();
        if (!ch) return bad('bulunamadı', 404);
        const sc = scoreOf(won, sec, used, won ? 100 : pct), now = Date.now();
        const old = await db.prepare('SELECT score FROM res WHERE cid = ? AND pid = ?').bind(id, b.pid).first();
        if (!old) {
          await db
            .prepare('INSERT INTO res (cid, pid, nick, won, sec, used, pct, score, tries, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)')
            .bind(id, b.pid, nick, won, sec, used, won ? 100 : pct, sc, now)
            .run();
        } else if (sc < old.score) {
          await db
            .prepare('UPDATE res SET nick = ?, won = ?, sec = ?, used = ?, pct = ?, score = ?, tries = tries + 1, updated = ? WHERE cid = ? AND pid = ?')
            .bind(nick, won, sec, used, won ? 100 : pct, sc, now, id, b.pid)
            .run();
        } else {
          await db.prepare('UPDATE res SET nick = ?, tries = tries + 1 WHERE cid = ? AND pid = ?').bind(nick, id, b.pid).run();
        }
        const o = await board(db, id);
        o.me = b.pid.slice(0, 6);
        o.better = !old || sc < old.score;
        return j(o);
      }
    }
    return bad('yok', 404);
  } catch (e) {
    return bad('sunucu hatası', 500);
  }
}
