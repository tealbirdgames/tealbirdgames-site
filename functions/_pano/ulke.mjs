// VAPURA PANO — oyuncu ülkesi (Cloudflare ülke kodu, 2 harf; IP / şehir saklanmaz). 27.11.2026'dan beri tutuluyor.
export const ULKE_BASLANGIC = "2026-11-27";
const oku = async (db, sql, ...b) => { try { return (await db.prepare(sql).bind(...b).all()).results; } catch (e) { if (/no such table/i.test(String(e && e.message))) return []; throw e; } };
export async function ulkeler(db, idler) {
  const m = new Map(); if (!idler || !idler.length) return m;
  for (let i = 0; i < idler.length; i += 800) for (const r of await oku(db, "SELECT u.id AS id, u.ulke AS ulke FROM json_each(?) x JOIN oyuncu_ulke u ON u.id = x.value", JSON.stringify(idler.slice(i, i + 800)))) m.set(r.id, r.ulke);
  return m;
}
export async function ulkeTek(db, id) { const r = await oku(db, "SELECT ulke FROM oyuncu_ulke WHERE id = ?", id); return r[0] ? r[0].ulke : null; }
export async function ulkelerUcu(db, bugun, gunKaydir) {
  const yedi = gunKaydir(bugun, -6);
  const r = await oku(db, "SELECT ulke, COUNT(*) AS toplam, SUM(gun >= ?) AS aktif7 FROM oyuncu_ulke GROUP BY ulke ORDER BY toplam DESC", yedi);
  const ilk = r.slice(0, 10), dg = r.slice(10), top = (l, k) => l.reduce((a, x) => a + (x[k] || 0), 0);
  return { ok: true, bugun, baslangic: ULKE_BASLANGIC, ulkeSayisi: r.length, toplam: top(r, "toplam"), aktif7: top(r, "aktif7"),
    ulkeler: ilk.map((x) => ({ ulke: x.ulke, toplam: x.toplam, aktif7: x.aktif7 || 0 })), diger: { ulkeSayisi: dg.length, toplam: top(dg, "toplam"), aktif7: top(dg, "aktif7") } };
}
