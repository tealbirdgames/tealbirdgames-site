// VAPURA PANO — isim değişiklikleri. Yazan: /api/lb (takma ad değişince). Saatler Türkiye saati (UTC+3).
export const AD_PANO_YOLU = "/api/pano-adlar";
const TR = 3 * 3600000, BOYUT = 50;
const trGun = (ms) => new Date(ms + TR).toISOString().slice(0, 10);
const trSaat = (ms) => new Date(ms + TR).toISOString().slice(11, 16);
const kod = (pid) => { const n = pid.length; return String(1000 + ((pid.charCodeAt(n - 1) * 961 + pid.charCodeAt(n - 2) * 31 + pid.charCodeAt(n - 3)) % 9000)); };
const oku = async (db, sql, ...b) => { try { return (await db.prepare(sql).bind(...b).all()).results; } catch (e) { if (/no such table/i.test(String(e && e.message))) return []; throw e; } };

export async function adGecmisYaz(db, id, eski, yeni, simdi) {
  if (!eski || eski === yeni) return;
  await db.prepare("INSERT OR IGNORE INTO ad_gecmis (id, zaman, eski, yeni) VALUES (?, ?, ?, ?)").bind(id, simdi, eski, yeni).run();
  await db.prepare("DELETE FROM ad_gecmis WHERE id = ? AND zaman NOT IN (SELECT zaman FROM ad_gecmis WHERE id = ? ORDER BY zaman DESC LIMIT 20)").bind(id, id).run();
}
export async function adGecmisOyuncu(db, id) {
  return (await oku(db, "SELECT eski, yeni, zaman FROM ad_gecmis WHERE id = ? ORDER BY zaman DESC", id)).map((r) => ({ eski: r.eski, yeni: r.yeni, gun: trGun(r.zaman), saat: trSaat(r.zaman) }));
}
export async function adlarIsle(db, s, simdi, opak) {
  const bugun = trGun(simdi), sayfa = Math.max(1, Math.min(200, Number(s.sayfa) || 1));
  const bas30 = Date.parse(bugun + "T00:00:00Z") - TR - 29 * 86400000;
  const r = await oku(db, "SELECT a.id AS id, a.zaman AS zaman, a.eski AS eski, a.yeni AS yeni, l.nick AS simdiki, l.lvl AS bolum, l.stars AS yildiz FROM ad_gecmis a LEFT JOIN lb l ON l.pid = a.id WHERE a.zaman >= ? ORDER BY a.zaman DESC", bas30);
  const ilk = (await oku(db, "SELECT MIN(zaman) AS z FROM ad_gecmis"))[0];
  const gunler = Array.from({ length: 30 }, (_, i) => { const g = new Date(Date.parse(bugun + "T00:00:00Z") - (29 - i) * 86400000).toISOString().slice(0, 10); const x = r.filter((y) => trGun(y.zaman) === g); return { gun: g, degisiklik: x.length, kisi: new Set(x.map((y) => y.id)).size }; });
  const ozetle = (n) => { const alt = gunler[30 - n].gun, x = r.filter((y) => trGun(y.zaman) >= alt); return { degisiklik: x.length, kisi: new Set(x.map((y) => y.id)).size }; };
  const dunG = gunler[28].gun, dunX = r.filter((y) => trGun(y.zaman) === dunG);
  const liste = await Promise.all(r.slice((sayfa - 1) * BOYUT, sayfa * BOYUT).map(async (y) => ({ k: await opak(y.id), eski: y.eski, yeni: y.yeni, simdikiAd: y.simdiki || y.yeni, kod: kod(y.id), gun: trGun(y.zaman), saat: trSaat(y.zaman), bolum: y.bolum ?? null, yildiz: y.yildiz ?? null })));
  return { durum: 200, govde: { ok: true, bugun, saatDilimi: "Türkiye saati", ilkKayit: ilk && ilk.z ? trGun(ilk.z) : null, toplam: r.length, kisi: new Set(r.map((y) => y.id)).size, sayfa, boyut: BOYUT,
    ozet: { bugun: ozetle(1), dun: { degisiklik: dunX.length, kisi: new Set(dunX.map((y) => y.id)).size }, yedi: ozetle(7), otuz: ozetle(30) }, gunler, liste } };
}
