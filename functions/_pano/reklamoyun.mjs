// VAPURA PANO — oyundaki reklamlar (yalnız oynanış verisine izin veren oyuncular). Ham olay yok, gün × oyuncu × olay × yer sayaçları.
export const REKLAM_OYUN = { bellekSn: 240 };
export const REKLAM_OYUN_YOLU = "/api/pano-reklam-oyun";
const oku = async (db, sql, ...b) => { try { return (await db.prepare(sql).bind(...b).all()).results; } catch (e) { if (/no such table/i.test(String(e && e.message))) return []; throw e; } };
const kay = (g, n) => new Date(Date.parse(g + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const yuzde = (a, b) => (b > 0 ? Math.round((100 * a) / b) : null);
const ALAN = { gecis_gosterildi: "gecis", gecis_yok: "gecisYok", odullu_basladi: "odulluBasladi", odullu_tamam: "odulluTamam", odullu_yarim: "odulluYarim", odullu_yok: "odulluYok", reklamsiz_teklif_goruldu: "teklifGoruldu", reklamsiz_teklif_kabul: "teklifKabul", reklamsiz_teklif_ret: "teklifRet" };
const bos = () => ({ gecis: 0, gecisYok: 0, odulluBasladi: 0, odulluTamam: 0, odulluYarim: 0, odulluYok: 0, teklifGoruldu: 0, teklifKabul: 0, teklifRet: 0 });
function tamamla(t, kisi) {
  const gos = t.gecis + t.odulluTamam;
  return { ...t, gorenOyuncu: kisi, reklamGosterim: gos, kisiBasi: kisi ? Math.round((gos / kisi) * 10) / 10 : null, gecisDolmaYuzde: yuzde(t.gecis, t.gecis + t.gecisYok),
    odulluDolmaYuzde: yuzde(t.odulluBasladi, t.odulluBasladi + t.odulluYok), odulluBitirmeYuzde: yuzde(t.odulluTamam, t.odulluBasladi), teklifKabulYuzde: yuzde(t.teklifKabul, t.teklifGoruldu) };
}
export async function reklamOyunUcu(db, s, z, opak, adlar) {
  const aralik = [1, 7, 30].includes(Number(s.aralik)) ? Number(s.aralik) : 1;
  const gunden = aralik === 1 ? z.gun : kay(z.bugun, -(aralik - 1)), gune = aralik === 1 ? z.gun : z.bugun, dizBas = kay(z.bugun, -29);
  const lo = gunden < dizBas ? gunden : dizBas;
  const r = await oku(db, "SELECT gun, id, olay, yer, platform, derleme, say FROM reklam_sayac WHERE gun >= ? AND gun <= ?", lo, z.bugun);
  const ic = r.filter((x) => x.gun >= gunden && x.gun <= gune);
  const top = bos(), kisi = new Set(), plat = new Map(), yer = new Map(), kisiSay = new Map();
  for (const x of ic) {
    const a = ALAN[x.olay]; if (!a) continue; top[a] += x.say; if (a === "gecis" || a === "odulluTamam") kisi.add(x.id);
    const pk = x.platform + "|" + x.derleme; let p = plat.get(pk); if (!p) plat.set(pk, p = { platform: x.platform, derleme: x.derleme, t: bos(), k: new Set() }); p.t[a] += x.say; if (a === "gecis" || a === "odulluTamam") p.k.add(x.id);
    if (x.olay.startsWith("odullu")) { let y = yer.get(x.yer); if (!y) yer.set(x.yer, y = { yer: x.yer, basladi: 0, tamam: 0, yarim: 0, yok: 0 }); y[{ odullu_basladi: "basladi", odullu_tamam: "tamam", odullu_yarim: "yarim", odullu_yok: "yok" }[x.olay]] += x.say; }
    if (a === "gecis" || a === "odulluTamam") { let k = kisiSay.get(x.id); if (!k) kisiSay.set(x.id, k = { gecis: 0, odullu: 0 }); if (a === "gecis") k.gecis += x.say; else k.odullu += x.say; }
  }
  const dizi = Array.from({ length: 30 }, (_, i) => { const g = kay(dizBas, i), x = r.filter((y) => y.gun === g), o = { gun: g, gecis: 0, odullu: 0, odulluBasladi: 0, gecisYok: 0, oyuncu: 0 }, k = new Set();
    for (const y of x) { if (y.olay === "gecis_gosterildi") { o.gecis += y.say; k.add(y.id); } else if (y.olay === "odullu_tamam") { o.odullu += y.say; k.add(y.id); } else if (y.olay === "odullu_basladi") o.odulluBasladi += y.say; else if (y.olay === "gecis_yok") o.gecisYok += y.say; }
    o.oyuncu = k.size; return o; });
  const enCokL = [...kisiSay.entries()].map(([id, k]) => ({ id, ...k, toplam: k.gecis + k.odullu })).sort((a, b) => b.toplam - a.toplam).slice(0, 30);
  const ad = enCokL.length ? await adlar(enCokL.map((x) => x.id)) : new Map();
  const enCok = await Promise.all(enCokL.map(async (x) => { const a = ad.get(x.id); return { k: await opak(x.id), ad: a ? a.ad : null, kod: a ? a.kod : null, gecis: x.gecis, odullu: x.odullu, toplam: x.toplam }; }));
  return { durum: 200, govde: { ok: true, gun: z.gun, bugun: z.bugun, aralik, gunden, gune, ozet: tamamla(top, kisi.size), dizi,
    platformlar: [...plat.values()].sort((a, b) => (a.platform < b.platform ? -1 : a.platform > b.platform ? 1 : a.derleme - b.derleme)).map((p) => ({ platform: p.platform, derleme: p.derleme, ...tamamla(p.t, p.k.size) })),
    yerler: [...yer.values()].sort((a, b) => b.basladi - a.basladi), enCok } };
}
export async function reklamOyuncuOzet(db, id, bugun) {
  const r = await oku(db, "SELECT gun, olay, SUM(say) AS n FROM reklam_sayac WHERE id = ? AND olay IN ('gecis_gosterildi','odullu_tamam') GROUP BY gun, olay", id);
  if (!r.length) return null;
  const top = (f) => { const o = { gecis: 0, odullu: 0 }; for (const x of r) if (f(x.gun)) { if (x.olay === "gecis_gosterildi") o.gecis += x.n; else o.odullu += x.n; } return o; };
  const yedi = kay(bugun, -6);
  return { bugun: top((g) => g === bugun), son7: top((g) => g >= yedi && g <= bugun), toplam: top(() => true) };
}
