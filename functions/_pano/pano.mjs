// VAPURA YETİŞ — PANO. Onur Mutlu (Knock Shot) panosundan uyarlandı; YALNIZ OKUYAN uçlar. Ayrı dosya; lib/cekirdek.mjs ve öbür modüller DEĞİŞMEZ.
//
// SALT OKUNUR: bu dosyadaki bütün sorgular SELECT'tir. Tablo kurmaz, bakım yapmaz, sayaç yazmaz (test: test/pano_birim.mjs her sorguyu kaydeder).
// YETKİ: yeni ortam değişkeni PANO_ANAHTAR (gizli, ≥ 24 karakter). Tanımsızsa uçlar KAPALIDIR (503). YONETICI_ANAHTAR de kabul edilir.
//        PANO_ANAHTAR hiçbir yazan uçta geçmez (o uçlar yalnız YONETICI_ANAHTAR'a bakar). İkisi aynı yapılırsa pano uçları kapanır.
// GİZLİLİK: yanıtlarda iç oyuncu kimliği, anahtar karması, IP, kurtarma kodu, yedek içeriği YOKTUR. Oyuncu kartı için şifreli, opak "k" verilir.
//           Saat, dil yoktur (sunucu bunları saklamıyor). PANO ÜLKE 1: ülke = Cloudflare ülke kodu (2 harf, lib/ulke.mjs; 26.11.2026'dan beri). Ad yalnız sıralamaya ad yazarak katılanlarda vardır.
// YÜK: hiçbir sorgu bütün oynama kayıtlarını taramaz. Gün aralığı dizinden (oynama_paket_gun, oynama_gun_sira), oyuncu geçmişi birincil anahtardan okunur.
//      Tek istisna: toplam oyuncu = oynama_oyuncu satır sayısı (oyuncu başına 1 küçük satır).
//
// GÜN TANIMI: kayıttaki "gun" oyuncunun CİHAZINDAKİ takvim günüdür (istemci yazar). Bir paketin satır günü = içindeki en yeni kayıt günü;
//   sunucu kaydı en çok 14 gün geriden ve 1 gün ileriden kabul ettiği için D gününün kayıtları satır günü [D, D+15] olan paketlerdedir.
// İLK GÜN: SAKLANAN kayıtlardaki ilk gün (varsayılan saklama 180 gün). Oyuncunun en küçük sıra numaralı 3 paketi (+ eski tablo satırları) okunur:
//   sıra numarası cihazda hep artar, kuyruk sırayla gider → ilk gün bu paketlerdedir.
import { OYNAMA, MODLAR, gunUtc, saklamaGunu } from "./oynama.mjs";
import { adAnahtar, araAnahtar } from "./siralama.mjs";
import { gelenlerIsle, GELENLER, GELENLER_YOLLARI } from "./gelenler.mjs";      // PANO GELENLER 1: "Bugün gelenler" (yalnız okur)
import { adlarIsle, adGecmisOyuncu, AD_PANO_YOLU } from "./adgecmis.mjs";      // PANO 2: isim değişiklikleri (yalnız okur)
import { reklamOku, REKLAM_PANO_YOLU } from "./appleads.mjs";
import { ulkeler, ulkeTek, ulkelerUcu, ULKE_BASLANGIC } from "./ulke.mjs";      // PANO ÜLKE 1: oyuncu ülkesi (yalnız okur)
import { reklamOyunUcu, reklamOyuncuOzet, REKLAM_OYUN, REKLAM_OYUN_YOLU } from "./reklamoyun.mjs";      // REKLAM KAYDI 1: oyundaki reklamlar (yalnız okur)      // PANO GELENLER 1: Apple Ads günlük özeti (yalnız okur; çekimi yönetici ucu / günlük bakım yapar)

export const PANO = {
  anahtarEnAz: 24,
  gunGeri: 30,            // en eski seçilebilir gün: sunucu gününden bu kadar geri
  grafikGun: 14,
  bolumGun: 30,           // bölüm / zor bölüm / sürüm tabloları: son bu kadar gün
  boyut: 50,              // liste sayfası
  sayfaEnCok: 200,
  siraOfsetEnCok: 2000,   // sıralamada sayfa ile en çok bu kadar aşağı inilir (ötesi için arama)
  araEnCok: 40,           // arama yazısı (karakter)
  zorEnAz: 10, zorSayi: 8,
  takilmaEnAz: 3,         // aynı bölümü bu kadar kez geçemeyen "takıldı"
  dilim: 800,             // tek sorguda en çok kimlik (JSON parametresi)
  bellekSn: 240,          // gün özeti: aynı çalışma örneğinde 4 dakika bellekten (PANO GERÇEK 2: D1 okuma yükü)
  bellekBolumSn: 1500     // bölüm tabloları (en ağır okuma): 25 dakika
};
export const PANO_YOLLARI = ["/api/pano-gun", "/api/pano-oyuncular", "/api/pano-oyuncu", "/api/pano-bolumler", "/api/pano-siralama", "/api/pano-gelenler", "/api/pano-gelenler-liste", "/api/pano-reklam", "/api/pano-adlar", "/api/pano-canli", REKLAM_OYUN_YOLU, "/api/pano-ulkeler"];

const GUN_RE = /^\d{4}-\d{2}-\d{2}$/;
const cevap = (durum, govde) => ({ durum, govde });
const hata = (durum, kod, mesaj) => cevap(durum, { ok: false, hata: kod, mesaj });
function esit(a, b) { if (a.length !== b.length) return false; let f = 0; for (let i = 0; i < a.length; i++) f |= a.charCodeAt(i) ^ b.charCodeAt(i); return f === 0; }
const gunMs = (g) => { const p = g.split("-"); return Date.UTC(+p[0], +p[1] - 1, +p[2]); };
export const gunKaydir = (g, n) => new Date(gunMs(g) + n * 86400000).toISOString().slice(0, 10);
const gunGecerli = (g) => GUN_RE.test(g) && !Number.isNaN(gunMs(g)) && gunKaydir(g, 0) === g;      // 2026-02-31 gibi olmayan gün reddedilir
const dilimle = (l, n) => { const d = []; for (let i = 0; i < l.length; i += n) d.push(l.slice(i, i + n)); return d; };

/* ───────── yetki ───────── */
export function panoYetki(baslik, ayar, A = PANO) {                  // → null (izinli) | hata yanıtı
  const pano = String(ayar.panoAnahtar || ""), yon = String(ayar.yoneticiAnahtar || "");
  if (pano.length < A.anahtarEnAz) return hata(503, "kapali", "Pano kapalı: sunucuda PANO_ANAHTAR tanımlı değil (en az " + A.anahtarEnAz + " karakter).");
  if (yon && esit(pano, yon)) return hata(503, "ayni", "Pano kapalı: PANO_ANAHTAR, yönetici anahtarından farklı olmalı.");
  const g = String((baslik && baslik["x-pano-anahtar"]) || ""), y = String((baslik && baslik["x-yonetici-anahtar"]) || "");
  if (g && (esit(g, pano) || (yon.length >= A.anahtarEnAz && esit(g, yon)))) return null;
  if (y && yon.length >= A.anahtarEnAz && esit(y, yon)) return null;
  return hata(403, "yetki", "Anahtar yanlış.");
}

/* ───────── opak oyuncu anahtarı (AES-GCM; anahtar PANO_ANAHTAR'dan türetilir). Aynı oyuncu → aynı "k". Anahtar değişirse eski "k"lar geçersizleşir. ───────── */
const yazi = new TextEncoder();
const b64 = (u) => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64c = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const sifreOnbellek = new Map();
async function sifreAl(gizli) {
  let s = sifreOnbellek.get(gizli); if (s) return s;
  const ozet = async (e) => crypto.subtle.digest("SHA-256", yazi.encode(e + gizli));
  s = { aes: await crypto.subtle.importKey("raw", await ozet("vapura-pano-kimlik-1:"), "AES-GCM", false, ["encrypt", "decrypt"]),
    iv: await crypto.subtle.importKey("raw", await ozet("vapura-pano-iv-1:"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]) };
  if (sifreOnbellek.size > 4) sifreOnbellek.clear(); sifreOnbellek.set(gizli, s); return s;
}
export async function opakYap(id, gizli) {
  const s = await sifreAl(gizli), iv = new Uint8Array(await crypto.subtle.sign("HMAC", s.iv, yazi.encode(id))).slice(0, 12);
  const c = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, s.aes, yazi.encode(id)));
  const u = new Uint8Array(12 + c.length); u.set(iv); u.set(c, 12); return b64(u);
}
export async function opakCoz(k, gizli) {                           // → id | null
  if (typeof k !== "string" || k.length < 24 || k.length > 200 || !/^[A-Za-z0-9_-]+$/.test(k)) return null;
  try { const s = await sifreAl(gizli), u = b64c(k); return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: u.slice(0, 12) }, s.aes, u.slice(12))); }
  catch (e) { return null; }
}

/* ───────── okuma sorguları ───────── */
const oku = async (db, sql, ...d) => (await db.prepare(sql).bind(...d).all()).results;
// ad / sıralama tabloları henüz yoksa (hiç kimse sıralamaya katılmadıysa) boş: gerçekten kimsenin adı yoktur.
const okuAd = async (db, sql, ...d) => { try { return await oku(db, sql, ...d); } catch (e) { if (/no such table/i.test(String(e && e.message))) return []; throw e; } };

const SUTUN = "json_extract(j.value, '$[0]') AS sira, json_extract(j.value, '$[1]') AS gun, json_extract(j.value, '$[2]') AS bolum, json_extract(j.value, '$[3]') AS mod, json_extract(j.value, '$[4]') AS sonuc, json_extract(j.value, '$[5]') AS kalan, json_extract(j.value, '$[6]') AS yildiz, json_extract(j.value, '$[9]') AS surum";
// [lo, hi] günlerinin kayıtları (iki depo biçimi birlikte). Parametreler: aralikBag(lo, hi)
export const ARALIK_SQL = "SELECT p.id AS id, " + SUTUN + " FROM oynama_paket p INDEXED BY oynama_paket_gun CROSS JOIN json_each(p.veri) j WHERE p.gun >= ? AND p.gun <= ? AND json_extract(j.value, '$[1]') BETWEEN ? AND ?"
  + " UNION ALL SELECT id, sira, gun, bolum, mod, sonuc, kalan, yildiz, surum FROM oynama INDEXED BY oynama_gun_sira WHERE gun >= ? AND gun <= ?";
export const aralikBag = (lo, hi) => [lo, gunKaydir(hi, OYNAMA.gunGeri + OYNAMA.gunIleri), lo, hi, lo, hi];
// bir oyuncunun bütün saklanan kayıtları (birincil anahtar / (id, sira) dizini)
export const OYUNCU_SQL = "SELECT " + SUTUN + " FROM oynama_paket p CROSS JOIN json_each(p.veri) j WHERE p.id = ?"
  + " UNION ALL SELECT sira, gun, bolum, mod, sonuc, kalan, yildiz, surum FROM oynama WHERE id = ?";
export const ILK_SQL = "SELECT x.value AS id,"
  + " (SELECT MIN(json_extract(j.value, '$[1]')) FROM oynama_paket p CROSS JOIN json_each(p.veri) j WHERE p.id = x.value AND p.paket <= COALESCE((SELECT q.paket FROM oynama_paket q WHERE q.id = x.value ORDER BY q.paket LIMIT 1 OFFSET 2), 2147483647)) AS a,"
  + " (SELECT MIN(o.gun) FROM oynama o WHERE o.id = x.value) AS b FROM json_each(?) x";
export const AD_SQL = "SELECT x.value AS id, s.ad AS ad, s.bolum AS bolum, s.yildiz AS yildiz, k.kod AS kod FROM json_each(?) x JOIN skor s ON s.id = x.value LEFT JOIN sira_kod k ON k.id = x.value";

async function ilkGunler(db, idler, A) {                            // → Map id → "YYYY-AA-GG"
  const m = new Map();
  for (const d of dilimle(idler, A.dilim)) for (const r of await oku(db, ILK_SQL, JSON.stringify(d))) {
    const g = r.a && r.b ? (r.a < r.b ? r.a : r.b) : r.a || r.b; if (g) m.set(r.id, g);
  }
  return m;
}
async function adlar(db, idler, A) {                                // → Map id → { ad, bolum, yildiz, kod }
  const m = new Map();
  for (const d of dilimle(idler, A.dilim)) for (const r of await okuAd(db, AD_SQL, JSON.stringify(d))) m.set(r.id, { ad: r.ad, bolum: r.bolum, yildiz: r.yildiz, kod: r.kod == null ? null : String(r.kod).padStart(4, "0") });
  return m;
}

/* ───────── hesaplar ───────── */
// bir oyuncunun bir grup kaydından: oynanan, normal modda vardığı bölüm, o kayıtlardaki yıldız (bölüm başına en iyi), son sürüm
function kisiOzet(kayitlar, bolumSayisi) {
  let yer = null, son = null; const yildiz = new Map();
  for (const x of kayitlar) {
    if (!son || x.gun > son.gun || (x.gun === son.gun && x.sira > son.sira)) son = x;
    if (x.mod !== "normal") continue;
    const v = Math.min(x.bolum + (x.sonuc === "kazandi" ? 1 : 0), bolumSayisi + 1); if (yer === null || v > yer) yer = v;
    if (x.sonuc === "kazandi") yildiz.set(x.bolum, Math.max(yildiz.get(x.bolum) || 0, x.yildiz));
  }
  return { n: kayitlar.length, yer, yildiz: [...yildiz.values()].reduce((a, b) => a + b, 0), surum: son ? son.surum : null };
}
const grupla = (satirlar) => { const m = new Map(); for (const r of satirlar) { let l = m.get(r.id); if (!l) m.set(r.id, l = []); l.push(r); } return m; };
// bir günün oyuncuları, sıralı (çok oynayan üstte). gunSatir: ARALIK_SQL(D, D)
function gunListesi(gunSatir, ilk, gun, bolumSayisi) {
  const l = [];
  for (const [id, k] of grupla(gunSatir)) l.push({ id, ...kisiOzet(k, bolumSayisi), yeni: ilk.get(id) === gun });
  return l.sort((a, b) => b.n - a.n || (b.yer || 0) - (a.yer || 0) || (a.id < b.id ? -1 : 1));
}
async function listeSatirlari(l, ad, gizli, ul) {                       // iç kayıt → dışarı çıkan satır (kimlik YOK)
  return Promise.all(l.map(async (p) => {
    const a = ad.get(p.id);
    return { k: await opakYap(p.id, gizli), ad: a ? a.ad : null, kod: a ? a.kod : null, yeni: p.yeni, oynanan: p.n, kaldigiYer: p.yer,
      ulastigiBolum: a ? a.bolum : p.yer, yildiz: a ? a.yildiz : p.yeni ? p.yildiz : null, surum: p.surum, ulke: (ul && ul.get(p.id)) || null };
  }));
}
// arama: ad parçası (büyük/küçük ve aksan farkı gözetmez) ya da kod
function aramaSuz(l, ad, ara) {
  const kod = ara.replace(/^#/, ""), rakam = /^\d{1,4}$/.test(kod), n = araAnahtar(ara);
  return l.filter((p) => { const a = ad.get(p.id); if (!a) return false; return (rakam && a.kod && a.kod.startsWith(kod)) || (n && araAnahtar(a.ad).includes(n)); });
}

/* ───────── uçlar ───────── */
// Gün sınırları. → { gun, bugun, utc } | { hata }
function gunAl(s, simdi, A) {
  const utc = gunUtc(simdi), alt = gunKaydir(utc, -A.gunGeri), ust = gunKaydir(utc, OYNAMA.gunIleri);
  const bugun = s.bugun ? String(s.bugun) : utc, gun = s.gun ? String(s.gun) : bugun;
  for (const g of [bugun, gun]) if (!gunGecerli(g) || g < alt || g > ust) return { hata: hata(400, "gun", "Gün geçersiz (en çok " + A.gunGeri + " gün geri).") };
  if (bugun < gunKaydir(utc, -1)) return { hata: hata(400, "gun", "bugun geçersiz.") };
  if (gun > bugun) return { hata: hata(400, "gun", "Gün bugünden ileri olamaz.") };
  return { gun, bugun, utc, alt };
}
const ust = (utc) => gunKaydir(utc, OYNAMA.gunIleri);

async function gunUcu(db, z, ayar, A) {
  const { gun, bugun, utc } = z, grafikBas = gunKaydir(bugun, -(A.grafikGun - 1)), onceki = gunKaydir(gun, -1);
  const lo = onceki < grafikBas ? onceki : grafikBas;
  // 1) pencere: oyuncu × gün × mod toplamları (pencere sunucunun yarınına kadar uzanır: "o güne kadar toplam oyuncu" için sonradan gelenler gerekir)
  const w = await oku(db, "SELECT id, gun, mod, COUNT(*) AS n, SUM(sonuc = 'kazandi') AS k FROM (" + ARALIK_SQL + ") GROUP BY id, gun, mod", ...aralikBag(lo, ust(utc)));
  const idler = [...new Set(w.map((r) => r.id))];
  const ilk = await ilkGunler(db, idler, A);                                        // 2) ilk günler
  const enAz = new Map(); for (const r of w) if (!enAz.has(r.id) || r.gun < enAz.get(r.id)) enAz.set(r.id, r.gun);
  for (const id of idler) if (!ilk.has(id) || enAz.get(id) < ilk.get(id)) ilk.set(id, enAz.get(id));
  const hepsi = (await oku(db, "SELECT COUNT(*) AS n FROM oynama_oyuncu"))[0].n;       // 3) saklanan kayıtlardaki oyuncu sayısı
  const gunler = new Map();
  for (const r of w) {
    let d = gunler.get(r.gun); if (!d) gunler.set(r.gun, d = { kisi: new Set(), bolum: 0, kazanilan: 0 });
    d.kisi.add(r.id); d.bolum += r.n; d.kazanilan += r.k;
  }
  const ozet = (g) => {
    const d = gunler.get(g), oynayan = d ? d.kisi.size : 0; let yeni = 0; if (d) for (const id of d.kisi) if (ilk.get(id) === g) yeni++;
    let sonra = 0; for (const id of idler) if (ilk.get(id) > g) sonra++;
    return { gun: g, oynayan, yeni, geriGelen: oynayan - yeni, toplamOyuncu: Math.max(0, hepsi - sonra), oynananBolum: d ? d.bolum : 0, kazanilan: d ? d.kazanilan : 0, kazanmaYuzde: d && d.bolum ? Math.round((100 * d.kazanilan) / d.bolum) : null };
  };
  const grafik = Array.from({ length: A.grafikGun }, (_, i) => { const o = ozet(gunKaydir(grafikBas, i)); return { gun: o.gun, oynayan: o.oynayan, yeni: o.yeni }; });
  const modlar = MODLAR.map((m) => { const r = w.filter((x) => x.gun === gun && x.mod === m); return { mod: m, oynayan: r.length, oynananBolum: r.reduce((a, x) => a + x.n, 0) }; });
  // PANO 2: aktif oyuncu (bugün dahil son 3 / 7 günde en az bir bölüm kaydı olan; pencere satırlarından, ek sorgu yok) + kayıtlı oyuncu (ad#kod alan herkes; küçük özet tablosu)
  const aktifSay = (n) => { const alt = gunKaydir(bugun, -(n - 1)), k = new Set(); for (const r of w) if (r.gun >= alt && r.gun <= bugun) k.add(r.id); return k.size; };
  const kayitli = ((await okuAd(db, "SELECT COALESCE(SUM(sayi), 0) AS n FROM skor_bolum"))[0] || { n: 0 }).n;
  const genel = { aktif3: aktifSay(3), aktif7: aktifSay(7), kayitli, veriPaylasan: hepsi };
  const satir = await oku(db, ARALIK_SQL, ...aralikBag(gun, gun));                       // 4) seçili günün kayıtları
  const liste = gunListesi(satir, ilk, gun, ayar.bolumSayisi), yeniL = liste.filter((p) => p.yeni);
  const sayfaY = yeniL.slice(0, A.boyut), sayfaO = liste.slice(0, A.boyut);
  const ad = await adlar(db, [...new Set([...sayfaY, ...sayfaO].map((p) => p.id))], A);   // 5) adlar
  const ul = await ulkeler(db, [...new Set([...sayfaY, ...sayfaO].map((p) => p.id))]);    // 6) ülkeler (PANO ÜLKE 1)
  return cevap(200, { ok: true, gun, bugun, enEskiGun: gunKaydir(bugun, -(A.gunGeri - 1)), ilkGunAnlami: "saklanan-kayitlar", saklamaGun: ayar.saklamaGun, bolumSayisi: ayar.bolumSayisi,
    ozet: ozet(gun), onceki: ozet(onceki), genel, grafik, modlar,
    yeni: { toplam: yeniL.length, sayfa: 1, boyut: A.boyut, liste: await listeSatirlari(sayfaY, ad, ayar.panoAnahtar, ul) },
    oynayan: { toplam: liste.length, sayfa: 1, boyut: A.boyut, liste: await listeSatirlari(sayfaO, ad, ayar.panoAnahtar, ul) } });
}

function sayfaAl(s, A) { const n = s.sayfa === undefined || s.sayfa === "" ? 1 : Number(s.sayfa); return Number.isInteger(n) && n >= 1 && n <= A.sayfaEnCok ? n : null; }
function araAl(s, A) { const a = String(s.ara || "").trim(); return [...a].length <= A.araEnCok ? a : null; }

// SORGU YÜKÜ 1: günün oyuncu listesi (ham kayıtlar + ilk günler) her sayfa / aramada yeniden okunuyordu. Aynı çalışma örneğinde
//   pano-gun ile aynı süre (A.bellekSn) bellekte tutulur; sayfa, arama ve tür süzgeci bellekteki listeye uygulanır (yanıt biçimi aynı).
const gunListeBellek = new WeakMap();
async function gunListesiAl(db, z, ayar, A, simdi) {
  const anahtar = z.gun + "|" + z.bugun + "|" + ayar.bolumSayisi, sn = A.bellekSn;
  let m = gunListeBellek.get(db); if (!m) gunListeBellek.set(db, m = new Map());
  const v = m.get(anahtar); if (sn > 0 && v && simdi - v.t < sn * 1000 && simdi >= v.t) return v.l;
  const satir = await oku(db, ARALIK_SQL, ...aralikBag(z.gun, z.gun));
  const idler = [...new Set(satir.map((r) => r.id))], ilk = await ilkGunler(db, idler, A);
  const l = gunListesi(satir, ilk, z.gun, ayar.bolumSayisi);
  if (sn > 0) { if (m.size >= 8) m.clear(); m.set(anahtar, { t: simdi, l }); }
  return l;
}
async function oyuncularUcu(db, s, z, ayar, A, simdi = Date.now()) {
  const tur = String(s.tur || "oynayan"), sayfa = sayfaAl(s, A), ara = araAl(s, A);
  if (tur !== "yeni" && tur !== "oynayan") return hata(400, "tur", "tur: yeni | oynayan");
  if (sayfa === null) return hata(400, "sayfa", "Sayfa geçersiz.");
  if (ara === null) return hata(400, "ara", "Arama çok uzun.");
  let l = await gunListesiAl(db, z, ayar, A, simdi); if (tur === "yeni") l = l.filter((p) => p.yeni);
  let ad = null; if (ara) { ad = await adlar(db, l.map((p) => p.id), A); l = aramaSuz(l, ad, ara); }
  const d = l.slice((sayfa - 1) * A.boyut, sayfa * A.boyut); if (!ad) ad = await adlar(db, d.map((p) => p.id), A);
  return cevap(200, { ok: true, gun: z.gun, tur, toplam: l.length, sayfa, boyut: A.boyut, liste: await listeSatirlari(d, ad, ayar.panoAnahtar, await ulkeler(db, d.map((p) => p.id))) });
}

async function oyuncuUcu(db, s, z, ayar, A) {
  const id = await opakCoz(String(s.k || ""), ayar.panoAnahtar); if (!id) return hata(400, "k", "Oyuncu anahtarı geçersiz.");
  const r = await oku(db, OYUNCU_SQL, id, id); if (!r.length) return hata(404, "yok", "Bu oyuncunun kaydı yok (silinmiş olabilir).");
  const gunler = [...new Set(r.map((x) => x.gun))].sort(), o = kisiOzet(r, ayar.bolumSayisi), a = (await adlar(db, [id], A)).get(id);
  const ulasilan = a ? a.bolum : o.yer;
  let takildi = null;                                                // vardığı bölümü en az 3 kez geçemediyse
  if (o.yer !== null) { const kez = r.filter((x) => x.mod === "normal" && x.bolum === o.yer && x.sonuc !== "kazandi").length; if (kez >= A.takilmaEnAz) takildi = { bolum: o.yer, kez }; }
  const son14 = Array.from({ length: 14 }, (_, i) => { const g = gunKaydir(z.bugun, i - 13); return { gun: g, oynadi: gunler.includes(g) }; });
  return cevap(200, { ok: true, ilkGunAnlami: "saklanan-kayitlar", saklamaGun: ayar.saklamaGun, oyuncu: {
    ad: a ? a.ad : null, kod: a ? a.kod : null, surum: o.surum, ilkGun: gunler[0], sonGun: gunler[gunler.length - 1], gunSayisi: gunler.length,
    toplamDeneme: r.length, ulastigiBolum: ulasilan, yildiz: a ? a.yildiz : o.yildiz, takildi, son14, adGecmisi: await adGecmisOyuncu(db, id),
    ulke: await ulkeTek(db, id),      // PANO ÜLKE 1: son görülen ülke (yoksa null)
    reklam: await reklamOyuncuOzet(db, id, z.bugun) } });      // REKLAM KAYDI 1: bugün / son 7 gün / toplam (geçiş gösterilen, ödüllü tamamlanan)
}

async function bolumlerUcu(db, s, z, ayar, A) {
  const aralik = s.aralik === undefined || s.aralik === "" ? A.bolumGun : Number(s.aralik);
  if (aralik !== 1 && aralik !== A.bolumGun) return hata(400, "aralik", "aralik: 1 | " + A.bolumGun);
  const lo = aralik === 1 ? z.gun : gunKaydir(z.bugun, -(aralik - 1)), hi = aralik === 1 ? z.gun : z.bugun, bag = aralikBag(lo, hi);
  const b = await oku(db, "SELECT bolum, COUNT(*) AS deneme, COUNT(DISTINCT id) AS oynayan, SUM(sonuc = 'kazandi') AS kazanilan, COUNT(DISTINCT CASE WHEN sonuc = 'birakti' THEN id END) AS birakan,"
    + " AVG(CASE WHEN sonuc = 'kazandi' THEN yildiz END) AS yildiz, AVG(CASE WHEN sonuc = 'kazandi' THEN kalan END) AS top FROM (" + ARALIK_SQL + ") WHERE mod = 'normal' GROUP BY bolum ORDER BY bolum", ...bag);
  const yuv = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);
  const bolumler = b.map((x) => ({ bolum: x.bolum, deneme: x.deneme, oynayan: x.oynayan, kazanmaYuzde: x.deneme ? Math.round((100 * x.kazanilan) / x.deneme) : null, birakan: x.birakan, ortYildiz: yuv(x.yildiz), ortKalanTop: yuv(x.top), _o: x.deneme ? x.kazanilan / x.deneme : 1 }));
  const zor = bolumler.filter((x) => x.deneme >= A.zorEnAz).sort((a, c) => a._o - c._o || c.deneme - a.deneme).slice(0, A.zorSayi);
  const surumler = await oku(db, "SELECT surum, COUNT(DISTINCT id) AS oyuncu, COUNT(*) AS oynananBolum FROM (" + ARALIK_SQL + ") GROUP BY surum ORDER BY oynananBolum DESC LIMIT 20", ...bag);
  const sade = ({ _o, ...x }) => x;
  return cevap(200, { ok: true, aralik, gunden: lo, gune: hi, bolumler: bolumler.map(sade), zor: zor.map(sade), surumler });
}

const SIRA_SUTUN = "SELECT s.id AS id, s.ad AS ad, s.bolum AS bolum, s.yildiz AS yildiz, k.kod AS kod FROM ";
const SIRA_DUZEN = " ORDER BY s.nb, s.ny, s.bz, s.rs";
export const SIRA_SQL = SIRA_SUTUN + "skor s LEFT JOIN sira_kod k ON k.id = s.id" + SIRA_DUZEN + " LIMIT ? OFFSET ?";
export const SIRA_IDLER_SQL = SIRA_SUTUN + "json_each(?) x CROSS JOIN skor s ON s.id = x.value LEFT JOIN sira_kod k ON k.id = s.id" + SIRA_DUZEN;

async function siralamaUcu(db, s, z, ayar, A) {
  const sayfa = sayfaAl(s, A), ara = araAl(s, A), yalnizYeni = String(s.yeni || "") === "1";
  if (sayfa === null) return hata(400, "sayfa", "Sayfa geçersiz.");
  if (ara === null) return hata(400, "ara", "Arama çok uzun.");
  const bas = (sayfa - 1) * A.boyut;
  const toplamAdli = ((await okuAd(db, "SELECT COALESCE(SUM(sayi), 0) AS n FROM skor_bolum"))[0] || { n: 0 }).n;
  let satirlar, toplam, sirali = false, dahaVar = false, ilk = null;
  if (yalnizYeni) {                                                   // seçili günde ilk kez gelen ve ad yazmış olanlar
    const g = await oku(db, "SELECT DISTINCT id FROM (" + ARALIK_SQL + ")", ...aralikBag(z.gun, z.gun)); ilk = await ilkGunler(db, g.map((r) => r.id), A);
    const yeni = g.map((r) => r.id).filter((id) => ilk.get(id) === z.gun);
    let l = [];
    for (const d of dilimle(yeni, A.dilim)) l.push(...await okuAd(db, SIRA_IDLER_SQL, JSON.stringify(d)));
    if (yeni.length > A.dilim) l.sort((a, b) => b.bolum - a.bolum || b.yildiz - a.yildiz || (a.id < b.id ? -1 : 1));
    if (ara) { const m = new Map(l.map((r) => [r.id, { ad: r.ad, kod: r.kod == null ? null : String(r.kod).padStart(4, "0") }])); l = aramaSuz(l, m, ara); }
    toplam = l.length; satirlar = l.slice(bas, bas + A.boyut);
  } else if (ara) {                                                   // ad BAŞLANGICI ya da 4 haneli kod: dizinden
    const kod = ara.replace(/^#/, ""); let idler = [];
    if (/^[1-9]\d{3}$/.test(kod)) idler = (await okuAd(db, "SELECT id FROM sira_kod WHERE kod = ? LIMIT ?", Number(kod), A.boyut)).map((r) => r.id);
    const n = adAnahtar(ara), an = araAnahtar(ara);
    if (n) idler.push(...(await okuAd(db, "SELECT id FROM sira_kod WHERE adn >= ? AND adn < ? ORDER BY adn LIMIT ?", n, n + "\u{10FFFF}", A.boyut)).map((r) => r.id));
    if (an) idler.push(...(await okuAd(db, "SELECT id FROM sira_ara WHERE ara >= ? AND ara < ? ORDER BY ara LIMIT ?", an, an + "\u{10FFFF}", A.boyut)).map((r) => r.id));
    idler = [...new Set(idler)];
    const l = idler.length ? await okuAd(db, SIRA_IDLER_SQL, JSON.stringify(idler)) : [];
    toplam = l.length; satirlar = l.slice(bas, bas + A.boyut);
  } else {
    if (bas >= A.siraOfsetEnCok) return hata(400, "sayfa", "Sıralamada en çok ilk " + A.siraOfsetEnCok + " oyuncu gezilir; aramayı kullan.");
    satirlar = await okuAd(db, SIRA_SQL, A.boyut, bas); toplam = toplamAdli; sirali = true;
    dahaVar = bas + satirlar.length < Math.min(toplam, A.siraOfsetEnCok) && satirlar.length === A.boyut;
  }
  if (!sirali) dahaVar = bas + satirlar.length < toplam;
  const eksik = satirlar.map((r) => r.id).filter((id) => !ilk || !ilk.has(id)), ek = await ilkGunler(db, eksik, A);
  const ilkAl = (id) => (ilk && ilk.get(id)) || ek.get(id) || null, ul = await ulkeler(db, satirlar.map((r) => r.id));
  const liste = await Promise.all(satirlar.map(async (r, i) => ({ k: await opakYap(r.id, ayar.panoAnahtar), sira: sirali ? bas + i + 1 : null, ad: r.ad, kod: r.kod == null ? null : String(r.kod).padStart(4, "0"),
    bolum: r.bolum, yildiz: r.yildiz, ilkGun: ilkAl(r.id), yeni: ilkAl(r.id) === z.gun, ulke: ul.get(r.id) || null })));
  return cevap(200, { ok: true, gun: z.gun, toplamAdli, toplam, sayfa, boyut: A.boyut, dahaVar, ilkGunAnlami: "saklanan-kayitlar", liste });
}

// PANO 2: "şu an oyunda". Sunucu oyuncunun çevrim içi olup olmadığını SAKLAMAZ; elde olan tek anlık iz skor.bz'dir (kaydolma ya da yeni bir bölüme geçme anı).
// Bu yüzden sayı = son 10 dakikada kaydolan ya da yeni bölüm geçenler. Eski bölümü yeniden oynayan / aynı bölümde 10 dakikadan uzun takılan / yalnız öbür modlarda oynayan görünmez.
export const CANLI = { yakinDk: 10, saatDk: 300, listeEnCok: 60, dilimDk: 15 };      // pencere: son 5 saat, 15 dakikalık dilimler
async function canliUcu(db, ayar, simdi, C = CANLI) {
  const yakin = simdi - C.yakinDk * 60000, saat = simdi - C.saatDk * 60000;
  const say = (await okuAd(db, "SELECT COALESCE(SUM(bz >= ?), 0) AS yakin, COUNT(*) AS saat FROM skor WHERE bz >= ? AND bz <= ?", yakin, saat, simdi + 60000))[0] || { yakin: 0, saat: 0 };
  const l = await okuAd(db, "SELECT s.id AS id, s.ad AS ad, s.bolum AS bolum, s.yildiz AS yildiz, s.bz AS bz, k.kod AS kod FROM skor s LEFT JOIN sira_kod k ON k.id = s.id WHERE s.bz >= ? AND s.bz <= ? ORDER BY s.bz DESC LIMIT ?", saat, simdi + 60000, C.listeEnCok);
  const ul = await ulkeler(db, l.map((r) => r.id));
  const liste = await Promise.all(l.map(async (r) => ({ k: await opakYap(r.id, ayar.panoAnahtar), ulke: ul.get(r.id) || null, ad: r.ad, kod: r.kod == null ? null : String(r.kod).padStart(4, "0"), bolum: r.bolum, yildiz: r.yildiz, dakikaOnce: Math.max(0, Math.floor((simdi - r.bz) / 60000)) })));
  const dm = C.dilimDk * 60000, adet = Math.ceil(C.saatDk / C.dilimDk), dilimler = new Array(adet).fill(0);      // [en eski … şimdi]
  for (const r of await okuAd(db, "SELECT CAST((? - bz) / ? AS INTEGER) AS d, COUNT(*) AS n FROM skor WHERE bz >= ? AND bz <= ? GROUP BY d", simdi, dm, saat, simdi)) { const i = adet - 1 - r.d; if (i >= 0 && i < adet) dilimler[i] = r.n; }
  return cevap(200, { ok: true, yakinDk: C.yakinDk, saatDk: C.saatDk, dilimDk: C.dilimDk, simdiOyunda: say.yakin || 0, sonSaat: say.saat || 0, dilimler, liste });
}

// aynı çalışma örneğinde kısa süreli bellek (yalnız bellekte: kişisel veri hiçbir paylaşılan önbelleğe yazılmaz). Yetki DAHA ÖNCE denetlenir.
const bellekler = new WeakMap();
async function bellekli(db, anahtar, sn, simdi, uret) {
  if (!(sn > 0)) return uret();
  let m = bellekler.get(db); if (!m) bellekler.set(db, m = new Map());
  const v = m.get(anahtar); if (v && simdi - v.t < sn * 1000 && simdi >= v.t) return { ...v.o, bellek: true };
  const o = await uret(); if (o.durum === 200) { if (m.size >= 24) m.clear(); m.set(anahtar, { t: simdi, o }); }
  return o;
}

/* istek: { yontem, yol, sorgu, baslik }.  db: D1 bağlaması (yoksa null).  ayar: { panoAnahtar, yoneticiAnahtar, bolumSayisi, saklamaGun }.  → { durum, govde, bellek? } */
export async function panoIsle(istek, db, ayar, simdi = Date.now(), A = PANO) {
  const y = istek.yontem.toUpperCase(), yol = istek.yol.replace(/\/+$/, ""), s = istek.sorgu || {};
  if (!PANO_YOLLARI.includes(yol)) return hata(404, "yol", "Uç yok.");
  if (y !== "GET") return hata(405, "yontem", "Yöntem desteklenmiyor.");
  const yh = panoYetki(istek.baslik, ayar, A); if (yh) return yh;
  if (yol === REKLAM_PANO_YOLU) return reklamOku(db, s, ayar, simdi);      // D1 yoksa da yanıt verir ("bağlı değil" / "veri yok")
  if (!db) return hata(503, "depo", "D1 bağlaması gerekir.");
  if (yol === "/api/pano-canli") return await canliUcu(db, ayar, simdi);
  if (yol === "/api/pano-ulkeler") return await bellekli(db, "u|" + gunUtc(simdi), A.bellekSn, simdi, async () => cevap(200, await ulkelerUcu(db, gunUtc(simdi), gunKaydir)));      // PANO ÜLKE 1: Genel > Ülkeler (UTC günü; son 7 gün = son görülme günü)
  if (yol === AD_PANO_YOLU) return await adlarIsle(db, s, simdi, (id) => opakYap(id, ayar.panoAnahtar));
  if (GELENLER_YOLLARI.includes(yol)) {      // kendi gün denetimi (Türkiye günü): gunAl'dan ÖNCE
    const G = A.gelenler || GELENLER, opak = (id) => opakYap(id, ayar.panoAnahtar), uzun = String(s.aralik) === "30";
    if (yol === "/api/pano-gelenler-liste") return await gelenlerIsle(yol, db, s, simdi, opak, G);
    return await bellekli(db, "gl|" + String(s.aralik || "") + "|" + String(s.gun || "") + "|" + ayar.panoAnahtar, uzun ? G.bellekUzunSn : G.bellekSn, simdi, () => gelenlerIsle(yol, db, s, simdi, opak, G));
  }
  const a = { ...ayar, saklamaGun: ayar.saklamaGun || saklamaGunu(OYNAMA), bolumSayisi: ayar.bolumSayisi || 120 };
  const z = gunAl(s, simdi, A); if (z.hata) return z.hata;
  try {
    if (yol === "/api/pano-gun") return await bellekli(db, "g|" + z.gun + "|" + z.bugun + "|" + a.panoAnahtar, A.bellekSn, simdi, () => gunUcu(db, z, a, A));
    if (yol === "/api/pano-oyuncular") return await oyuncularUcu(db, s, z, a, A, simdi);
    if (yol === REKLAM_OYUN_YOLU) return await bellekli(db, "ro|" + z.gun + "|" + z.bugun + "|" + String(s.aralik || "") + "|" + a.panoAnahtar, (A.reklamOyun || REKLAM_OYUN).bellekSn, simdi,
      () => reklamOyunUcu(db, s, z, (id) => opakYap(id, a.panoAnahtar), (idler) => adlar(db, idler, A), A.reklamOyun || REKLAM_OYUN));
    if (yol === "/api/pano-oyuncu") return await oyuncuUcu(db, s, z, a, A);
    if (yol === "/api/pano-bolumler") return await bellekli(db, "b|" + z.gun + "|" + z.bugun + "|" + String(s.aralik || ""), A.bellekBolumSn, simdi, () => bolumlerUcu(db, s, z, a, A));
    return await siralamaUcu(db, s, z, a, A);
  } catch (e) {
    // oynama tabloları hiç kurulmamışsa 0 göstermek yerine açıkça söylenir
    if (/no such (table|index|view): *(main\.)?oynama/i.test(String(e && e.message))) return hata(503, "veri-yok", "Oynama kaydı tablosu henüz yok.");
    throw e;
  }
}
