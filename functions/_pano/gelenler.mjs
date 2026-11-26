// VAPURA PANO — yeni kayıtlar: Kaptanlar Tablosu'na ilk kez katılanlar (lb.created). Günler Türkiye saati (UTC+3).
// "Önerilen ad" = oyunun verdiği adı hiç değiştirmemiş (ad_gecmis'te kaydı yok).
export const GELENLER = { bellekSn: 30, bellekUzunSn: 300 };
export const GELENLER_YOLLARI = ["/api/pano-gelenler", "/api/pano-gelenler-liste"];
const TR = 3 * 3600000, BOYUT = 50;
const trGun = (ms) => new Date(ms + TR).toISOString().slice(0, 10);
const trSaat = (ms) => new Date(ms + TR).toISOString().slice(11, 16);
const kay = (g, n) => new Date(Date.parse(g + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const gunBas = (g) => Date.parse(g + "T00:00:00Z") - TR;
const kod = (pid) => { const n = pid.length; return String(1000 + ((pid.charCodeAt(n - 1) * 961 + pid.charCodeAt(n - 2) * 31 + pid.charCodeAt(n - 3)) % 9000)); };
const oku = async (db, sql, ...b) => { try { return (await db.prepare(sql).bind(...b).all()).results; } catch (e) { if (/no such table/i.test(String(e && e.message))) return null; throw e; } };

async function oynayanlar(db, gun) {
  const r = await oku(db, "SELECT COUNT(DISTINCT p.id) AS n FROM oynama_paket p CROSS JOIN json_each(p.veri) j WHERE p.gun >= ? AND p.gun <= ? AND json_extract(j.value, '$[1]') = ?", gun, kay(gun, 15), gun);
  return r && r[0] ? r[0].n : null;
}
export async function gelenlerIsle(yol, db, s, simdi, opak) {
  const bugun = trGun(simdi);
  if (yol === "/api/pano-gelenler-liste") {
    const gun = /^\d{4}-\d{2}-\d{2}$/.test(String(s.gun || "")) ? String(s.gun) : bugun, suz = s.suz === "oneri" ? "oneri" : "hepsi", sayfa = Math.max(1, Math.min(200, Number(s.sayfa) || 1));
    const r = (await oku(db, "SELECT l.pid AS id, l.nick AS ad, l.lvl AS bolum, l.stars AS yildiz, l.created AS zaman, (SELECT COUNT(*) FROM ad_gecmis a WHERE a.id = l.pid) AS degisim, (SELECT a.eski FROM ad_gecmis a WHERE a.id = l.pid ORDER BY a.zaman ASC LIMIT 1) AS ilkAd, u.ulke AS ulke FROM lb l LEFT JOIN oyuncu_ulke u ON u.id = l.pid WHERE l.created >= ? AND l.created < ? ORDER BY l.created DESC", gunBas(gun), gunBas(kay(gun, 1)))) || [];
    const l = suz === "oneri" ? r.filter((x) => !x.degisim) : r;
    const liste = await Promise.all(l.slice((sayfa - 1) * BOYUT, sayfa * BOYUT).map(async (x) => ({ k: await opak(x.id), ad: x.ad, kod: kod(x.id), saat: trSaat(x.zaman), kayitGunu: gun, dizineSonra: false,
      ilkAd: x.ilkAd || null, adDegisim: x.degisim, surum: null, bolum: x.bolum, yildiz: x.yildiz, oneriAd: !x.degisim, ulke: x.ulke || null })));
    return { durum: 200, govde: { ok: true, toplam: l.length, sayfa, boyut: BOYUT, liste } };
  }
  const n = [1, 2, 7, 30].includes(Number(s.aralik)) ? Number(s.aralik) : 1, alt = kay(bugun, -(n - 1));
  const r = await oku(db, "SELECT l.created AS zaman, (SELECT COUNT(*) FROM ad_gecmis a WHERE a.id = l.pid) AS degisim FROM lb l WHERE l.created >= ?", gunBas(alt));
  const gunler = [];
  for (let i = 0; i < n; i++) {
    const g = kay(bugun, -i), x = (r || []).filter((y) => trGun(y.zaman) === g);
    gunler.push({ gun: g, yeniKayit: x.length, ilkSkor: x.length, oneriAd: x.filter((y) => !y.degisim).length, oynayan: i < 2 ? await oynayanlar(db, g) : null });
  }
  const top = (k) => gunler.reduce((a, x) => a + x[k], 0);
  return { durum: 200, govde: { ok: true, bugun, saatDilimi: "Türkiye saati", kayitTablosu: r !== null, toplam: { yeniKayit: top("yeniKayit"), ilkSkor: top("ilkSkor"), oneriAd: top("oneriAd") }, gunler } };
}
