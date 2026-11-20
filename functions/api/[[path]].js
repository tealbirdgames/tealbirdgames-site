// Vapura Yetiş / Ferry Tales — arkadaşla meydan okuma API'si (Cloudflare Pages Functions + D1)
// POST /api/ch            {L, nick, pid}                     -> {id}
// GET  /api/ch/:id                                           -> {id, L, by, rows:[...]}
// POST /api/ch/:id/res    {pid, nick, won, sec, used, pct}   -> {id, L, by, rows:[...], me}

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

export async function onRequest({ request, env, params }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: H });
  const db = env.DB;
  if (!db) return bad('db yok', 500);
  const parts = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);

  try {
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
