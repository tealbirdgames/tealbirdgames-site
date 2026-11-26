// VAPURA PANO — oynama kaydı (yazan uç) ve sabitler.
// POST /api/oynama      { pid, paket, kayitlar:[[sira,gun,bolum,mod,sonuc,kalan,yildiz,surum]], reklam?:{paket,platform,derleme,surum,satirlar:[[gun,olay,yer,sayi,bolum]]} }
// POST /api/oynama-sil  { pid }   → oyuncunun bütün oynama / reklam / ülke / ad geçmişi satırları silinir
// Yalnız oyuncu "Oynanış verisi gönder" iznini verdiyse oyun bu isteği yapar. Ad, e-posta, cihaz / reklam kimliği gelmez.
export const OYNAMA = { gunGeri: 14, gunIleri: 1, saklamaGun: 180, istekKayit: 30, istekReklam: 60, kisiGunluk: 400, gunToplam: 300000, reklamGunToplam: 300000 };
export const MODLAR = ["normal", "gunluk", "dongu"];
export const SONUC = ["kazandi", "kaybetti", "birakti"];
export const REKLAM_OLAY = ["gecis_gosterildi", "gecis_yok", "odullu_basladi", "odullu_tamam", "odullu_yarim", "odullu_yok", "reklamsiz_teklif_goruldu", "reklamsiz_teklif_kabul", "reklamsiz_teklif_ret"];
export const REKLAM_YER = ["bolumArasi", "can", "guclendirici", "ikiKat", "devam", "magaza", "magazaBedava", "diger"];
export const gunUtc = (ms) => new Date(ms).toISOString().slice(0, 10);
export const saklamaGunu = (A) => Math.max(15, A.saklamaGun);

const GUN_RE = /^\d{4}-\d{2}-\d{2}$/;
const gunKay = (g, n) => new Date(Date.parse(g + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const tam = (v, lo, hi) => { const n = Number(v); return Number.isInteger(n) && n >= lo && n <= hi ? n : null; };
export const okPid = (s) => typeof s === "string" && /^[A-Za-z0-9_-]{8,40}$/.test(s);
const okSurum = (s) => (typeof s === "string" && /^[0-9A-Za-z.\-]{1,12}$/.test(s) ? s : "?");

function kayitTemizle(x, alt, ust) {
  if (!Array.isArray(x)) return null;
  const sira = tam(x[0], 0, 1e9), gun = String(x[1] || ""), bolum = tam(x[2], 1, 400000), mod = String(x[3] || ""), sonuc = String(x[4] || "");
  if (sira === null || !GUN_RE.test(gun) || gun < alt || gun > ust || bolum === null || !MODLAR.includes(mod) || !SONUC.includes(sonuc)) return null;
  const kalan = tam(x[5], 0, 999) ?? 0, yildiz = tam(x[6], 0, 3) ?? 0;
  // Onur'un biçimi: [sira, gun, bolum, mod, sonuc, kalan, yildiz, top, ekTop, surum]
  return [sira, gun, bolum, mod, sonuc, kalan, yildiz, null, null, okSurum(x[7])];
}

export async function ulkeYaz(db, id, ulke, gun) {
  if (!ulke || !/^[A-Z]{2}$/.test(ulke) || ulke === "XX" || ulke === "T1") return;
  await db.prepare("INSERT INTO oyuncu_ulke (id, ulke, ilk, gun) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET ulke = excluded.ulke, gun = MAX(oyuncu_ulke.gun, excluded.gun) WHERE oyuncu_ulke.ulke <> excluded.ulke OR oyuncu_ulke.gun < excluded.gun")
    .bind(id, ulke, gun, gun).run();
}

let sonBakim = "";
async function bakim(db, bugun) {                                  // günde bir kez (çalışma örneği başına): saklama süresi dolanlar
  if (sonBakim === bugun) return; sonBakim = bugun;
  const sinir = gunKay(bugun, -OYNAMA.saklamaGun);
  await db.batch([
    db.prepare("DELETE FROM oynama_paket WHERE gun < ?").bind(sinir),
    db.prepare("DELETE FROM reklam_sayac WHERE gun < ?").bind(sinir),
    db.prepare("DELETE FROM oynama_gun WHERE gun < ?").bind(sinir),
    db.prepare("DELETE FROM oyun_reklam_gun WHERE gun < ?").bind(sinir),
  ]);
}

export async function oynamaYaz(db, b, ulke, simdi) {
  if (!b || !okPid(b.pid)) return { durum: 400, govde: { ok: false, hata: "gecersiz" } };
  const id = b.pid, bugun = gunUtc(simdi), alt = gunKay(bugun, -OYNAMA.gunGeri), ust = gunKay(bugun, OYNAMA.gunIleri);
  let yazilan = 0, reklamYazilan = 0;
  const paket = tam(b.paket, 1, 1e9), kayitlar = Array.isArray(b.kayitlar) ? b.kayitlar.slice(0, OYNAMA.istekKayit).map((x) => kayitTemizle(x, alt, ust)).filter(Boolean) : [];
  if (paket !== null && kayitlar.length) {
    const kisi = await db.prepare("SELECT gun, say FROM oynama_oyuncu WHERE id = ?").bind(id).first();
    const bugunSay = kisi && kisi.gun === bugun ? kisi.say : 0;
    const genel = await db.prepare("SELECT say FROM oynama_gun WHERE gun = ?").bind(bugun).first();
    if (bugunSay + kayitlar.length <= OYNAMA.kisiGunluk && (!genel || genel.say + kayitlar.length <= OYNAMA.gunToplam)) {
      const gun = kayitlar.reduce((m, x) => (x[1] > m ? x[1] : m), kayitlar[0][1]);
      const r = await db.prepare("INSERT OR IGNORE INTO oynama_paket (id, paket, gun, adet, veri) VALUES (?, ?, ?, ?, ?)").bind(id, paket, gun, kayitlar.length, JSON.stringify(kayitlar)).run();
      if (r.meta && r.meta.changes) {
        yazilan = kayitlar.length;
        await db.batch([
          db.prepare("INSERT INTO oynama_oyuncu (id, anahtar_karma, gun, say) VALUES (?, '', ?, ?) ON CONFLICT(id) DO UPDATE SET say = CASE WHEN oynama_oyuncu.gun = excluded.gun THEN oynama_oyuncu.say + excluded.say ELSE excluded.say END, gun = excluded.gun").bind(id, bugun, yazilan),
          db.prepare("INSERT INTO oynama_gun (gun, say) VALUES (?, ?) ON CONFLICT(gun) DO UPDATE SET say = say + excluded.say").bind(bugun, yazilan),
        ]);
      }
    }
  }
  const rk = b.reklam;
  if (rk && typeof rk === "object" && Array.isArray(rk.satirlar)) {
    const rp = tam(rk.paket, 1, 1e9), platform = ["ios", "android", "web"].includes(rk.platform) ? rk.platform : "web", derleme = tam(rk.derleme, 0, 1e6) ?? 0, surum = okSurum(rk.surum);
    const eski = rp === null ? null : await db.prepare("SELECT paket FROM reklam_oyuncu WHERE id = ?").bind(id).first();
    const genel = await db.prepare("SELECT say FROM oyun_reklam_gun WHERE gun = ?").bind(bugun).first();
    if (rp !== null && (!eski || rp > eski.paket) && (!genel || genel.say < OYNAMA.reklamGunToplam)) {
      const st = [];
      for (const x of rk.satirlar.slice(0, OYNAMA.istekReklam)) {
        if (!Array.isArray(x)) continue;
        const g = String(x[0] || ""), olay = String(x[1] || ""), yer = REKLAM_YER.includes(x[2]) ? x[2] : "diger", say = tam(x[3], 1, 50), bolum = tam(x[4], 0, 400000) ?? 0;
        if (!GUN_RE.test(g) || g < alt || g > ust || !REKLAM_OLAY.includes(olay) || say === null) continue;
        st.push(db.prepare("INSERT INTO reklam_sayac (gun, id, olay, yer, platform, derleme, surum, bolum, say) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(gun, id, olay, yer, platform, derleme) DO UPDATE SET say = say + excluded.say, surum = excluded.surum, bolum = MAX(bolum, excluded.bolum)")
          .bind(g, id, olay, yer, platform, derleme, surum, bolum, say));
        reklamYazilan += say;
      }
      st.push(db.prepare("INSERT INTO reklam_oyuncu (id, paket, gun, say) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET paket = excluded.paket, gun = excluded.gun, say = reklam_oyuncu.say + excluded.say").bind(id, rp, bugun, reklamYazilan));
      st.push(db.prepare("INSERT INTO oyun_reklam_gun (gun, say) VALUES (?, ?) ON CONFLICT(gun) DO UPDATE SET say = say + excluded.say").bind(bugun, reklamYazilan));
      await db.batch(st);
    }
  }
  if (yazilan || reklamYazilan) await ulkeYaz(db, id, ulke, bugun);
  try { await bakim(db, bugun); } catch (e) {}
  return { durum: 200, govde: { ok: true, yazilan, reklam: reklamYazilan } };
}

export async function oynamaSil(db, b) {
  if (!b || !okPid(b.pid)) return { durum: 400, govde: { ok: false, hata: "gecersiz" } };
  await db.batch(["oynama_paket", "oynama_oyuncu", "reklam_sayac", "reklam_oyuncu", "oyuncu_ulke", "ad_gecmis"].map((t) => db.prepare("DELETE FROM " + t + " WHERE id = ?").bind(b.pid)));
  return { durum: 200, govde: { ok: true } };
}
