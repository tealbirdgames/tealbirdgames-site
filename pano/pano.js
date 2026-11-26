// KNOCK SHOT — pano sayfası (PANO 2: sekmeli düzen + isim değişiklikleri). Yalnız GET ile okur. Anahtar istek başlığında gider (adrese yazılmaz).
// Kural: bilgi alınamazsa 0 yazılmaz, "alınamadı" yazılır; anahtar yanlışsa ekrandaki bütün sayılar silinir.
'use strict';
{
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Number(n).toLocaleString('tr-TR');
const yuzde = (n) => (n === null || n === undefined ? '–' : '%' + n);
const ondalik = (x) => (x === null || x === undefined ? '–' : x.toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const MODLAR = { normal: 'Normal', gunluk: 'Günlük bölüm', dongu: 'Döngü (120 sonrası)' };

const DEPO = 'vy_pano_okuma_anahtari', BEKLEME_MS = 25000, BOYUT = 50, GUN_GERI = 29;
// KENDİLİĞİNDEN YENİLEME YOK (sunucunun okuma yükü): veri yalnız sayfa açılınca, pano yeniden öne gelince (en az 2 dk sonra),
// "Yenile" / "Tekrar dene" ile ve kullanıcı bir şey isteyince (gün, liste, arama, kart) çekilir.
const DONUS_MS = 2 * 60000, DUGME_MS = 10000;
const ILK_YENI = 50, ILK_OYN = 12, ILK_SIRA = 10;

/* ───────── günler (cihazın takvimi) ───────── */
const iki = (n) => String(n).padStart(2, '0');
const yerelGun = () => { const d = new Date(); return d.getFullYear() + '-' + iki(d.getMonth() + 1) + '-' + iki(d.getDate()); };
const kaydir = (g, n) => new Date(Date.parse(g + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const tarihYaz = (g, o) => new Date(g + 'T00:00:00Z').toLocaleDateString('tr-TR', Object.assign({ timeZone: 'UTC' }, o));
const kisa = (g) => tarihYaz(g, { day: 'numeric', month: 'long' });
const uzun = (g) => kisa(g) + ' ' + tarihYaz(g, { weekday: 'long' });
const saatYaz = (ms) => { const d = new Date(ms); return iki(d.getHours()) + ':' + iki(d.getMinutes()); };

/* ───────── durum ───────── */
let anahtar = null, hatirla = false, nesil = 0, oyun = 'ks';
let bugun = yerelGun(), secili = bugun;
let yeniGoster = ILK_YENI, oynGoster = ILK_OYN, siraGoster = ILK_SIRA;
let grafik = null;                       // { bugun, liste, zaman }: gün değiştirirken grafik kaybolmasın
let bolumSayisi = null;
let glAralik = '1', glGun = null, glGoster = BOYUT, rkAralik = '7', adGoster = BOYUT, roAralik = '1';      // REKLAM KAYDI 1: roAralik = oyundaki reklamlar aralığı      // PANO GELENLER 1: Gelenler + Apple Ads bölümü
const SEKMELER = ['genel', 'oyuncular', 'adlar', 'bolumler', 'reklam', 'siralama'];
let sekme = 'genel';                     // PANO 2: açık sekme (adresin #… kısmında tutulur)
let sonTur = 0, donusBekliyor = false, dugmeBekle = null, araBekle = null, siraBekle = null;      // sonTur: son açılış / yenileme

const sorgu = (yol, p) => yol + '?' + new URLSearchParams(p).toString();
const sayfalar = (n, uret) => Array.from({ length: Math.max(1, Math.ceil(n / BOYUT)) }, (_, i) => uret(i + 1));
// her kaynak: tanim() → { imza, yollar } ya da null (şu an gerekmiyor)
const kaynak = (tanim) => ({ tanim, imza: null, veri: null, zaman: 0, hata: null, kontrol: null, surer: false });
const K = {
  gun: kaynak(() => { const y = sorgu('/api/pano-gun', { gun: secili, bugun }); return { imza: y, yollar: [y] }; }),
  yeni: kaynak(() => (yeniGoster <= BOYUT ? null : { imza: 'yeni|' + secili + '|' + bugun, yollar: sayfalar(yeniGoster, (s) => sorgu('/api/pano-oyuncular', { gun: secili, bugun, tur: 'yeni', sayfa: s })) })),
  oyn: kaynak(() => { const ara = $('ara').value.trim(); if (!ara && oynGoster <= BOYUT) return null;
    return { imza: 'oyn|' + secili + '|' + bugun + '|' + ara, yollar: sayfalar(oynGoster, (s) => sorgu('/api/pano-oyuncular', { gun: secili, bugun, tur: 'oynayan', ara, sayfa: s })) }; }),
  b30: kaynak(() => { const y = sorgu('/api/pano-bolumler', { gun: bugun, bugun, aralik: 30 }); return { imza: y, yollar: [y] }; }),
  bGun: kaynak(() => { if (!$('yalnizGun').checked) return null; const y = sorgu('/api/pano-bolumler', { gun: secili, bugun, aralik: 1 }); return { imza: y, yollar: [y] }; }),
  sira: kaynak(() => { const ara = $('sAra').value.trim(), yeni = $('yalnizYeni').checked ? '1' : '';
    return { imza: 'sira|' + secili + '|' + bugun + '|' + yeni + '|' + ara, yollar: sayfalar(siraGoster, (s) => sorgu('/api/pano-siralama', { gun: secili, bugun, ara, yeni, sayfa: s })) }; }),
  // PANO GELENLER 1: günler Türkiye saatine göre sunucuda hesaplanır (cihaz takvimine değil)
  gl: kaynak(() => { const y = sorgu('/api/pano-gelenler', { aralik: glAralik === 'd' ? 2 : glAralik }); return { imza: y, yollar: [y] }; }),
  glL: kaynak(() => { const g = glSeciliGun(); if (!g) return null; const suz = $('glOneri').checked ? 'oneri' : 'hepsi';
    return { imza: 'glL|' + g + '|' + suz, yollar: sayfalar(glGoster, (s) => sorgu('/api/pano-gelenler-liste', { gun: g, suz, sayfa: s })) }; }),
  rk: kaynak(() => { const y = sorgu('/api/pano-reklam', { aralik: rkAralik }); return { imza: y, yollar: [y] }; }),
  // REKLAM KAYDI 1: oyundaki reklamlar (tek istek: seçili aralık + 30 günlük dizi; genel sekmedeki "Bugün reklam" kutusu da bundan)
  ro: kaynak(() => { const y = sorgu('/api/pano-reklam-oyun', { gun: bugun, bugun, aralik: roAralik }); return { imza: y, yollar: [y] }; }),
  // PANO 2: isim değişiklikleri (eski → yeni); günler Türkiye saatine göre sunucuda
  // PANO 2: şu an oyunda (son 10 dk'da kaydolan / bölüm geçen). Küçük sorgu; pano açık ve görünürken dakikada bir yenilenir.
  canli: kaynak(() => ({ imza: 'canli', yollar: ['/api/pano-canli'] })),
  // PANO ÜLKE 1: Genel > Ülkeler (ülkeye göre oyuncu: toplam + son 7 gün aktif; ilk 10 + diğer)
  ul: kaynak(() => ({ imza: 'ul', yollar: ['/api/pano-ulkeler'] })),
  ad: kaynak(() => ({ imza: 'ad', yollar: sayfalar(adGoster, (n) => sorgu('/api/pano-adlar', { sayfa: n })) }))
};
// seçili gelenler günü: elle seçilen, yoksa aralığın en yeni günü ("Dün" düğmesinde dün)
function glSeciliGun() {
  const v = K.gl.veri; if (!v) return null;
  const gunler = v.gunler.map((x) => x.gun);
  if (glGun && gunler.includes(glGun)) return glGun;
  return glAralik === 'd' ? gunler[1] : gunler[0];
}

/* ───────── istek ───────── */
class Hata extends Error { constructor(durum, kod, mesaj) { super(mesaj || kod); this.durum = durum; this.kod = kod; } }
async function iste(yol, kontrol) {
  const sure = setTimeout(() => kontrol.abort(), BEKLEME_MS);
  try {
    const c = await fetch(yol, { method: 'GET', headers: { 'x-pano-anahtar': anahtar }, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: kontrol.signal });
    let j = null; try { j = await c.json(); } catch (e) { /* JSON değil */ }
    if (!c.ok || !j || j.ok !== true) throw new Hata(c.status, (j && j.hata) || 'cevap', j && j.mesaj);
    return j;
  } finally { clearTimeout(sure); }
}
// anahtarla ilgili (panoyu kapatan) hatalar → ekrandaki sayılar silinir
function kapatanMesaj(e) {
  if (e.durum === 403) return 'Anahtar yanlış.';
  if (e.durum === 503 && e.kod === 'kapali') return 'Pano kapalı: sunucuda PANO_ANAHTAR henüz tanımlı değil (en az 24 karakter olmalı).';
  if (e.durum === 503 && e.kod === 'ayni') return 'Pano kapalı: PANO_ANAHTAR yönetici anahtarından farklı olmalı.';
  return null;
}
// yenileme = "Yenile" ya da öne gelince: sıralama yalnız İLK sayfayı çeker; ekranda açık olan sonraki sayfalar olduğu gibi durur
async function yukle(ad, yenileme) {
  const s = K[ad], t = s.tanim();
  if (!t) { if (s.kontrol) s.kontrol.abort(); Object.assign(s, { imza: null, veri: null, hata: null, kontrol: null, surer: false }); ciz(); return; }
  if (s.kontrol) s.kontrol.abort();
  const kontrol = new AbortController(), n = nesil;
  if (s.imza !== t.imza) Object.assign(s, { imza: t.imza, veri: null, hata: null, zaman: 0 });
  const yalnizIlk = yenileme && ad === 'sira', eski = yalnizIlk ? s.veri : null;
  s.kontrol = kontrol; s.surer = true; ciz();
  try {
    let veri = null;
    for (const yol of yalnizIlk ? t.yollar.slice(0, 1) : t.yollar) {
      const j = await iste(yol, kontrol);
      if (kontrol !== s.kontrol || n !== nesil) return;
      veri = veri && j.liste ? Object.assign(j, { liste: veri.liste.concat(j.liste) }) : j;
      if (j.liste && (j.liste.length < j.boyut || j.dahaVar === false)) break;
    }
    if (eski && eski.sayfa > 1 && veri.dahaVar) {      // ilk sayfa yeni, sonrası eldeki (aynı oyuncu iki kez görünmez)
      const ilkler = new Set(veri.liste.map((p) => p.k));
      veri = Object.assign(veri, { liste: veri.liste.concat(eski.liste.slice(veri.liste.length).filter((p) => !ilkler.has(p.k))), dahaVar: eski.dahaVar, sayfa: eski.sayfa });
    }
    s.veri = veri; s.zaman = Date.now(); s.hata = null;
    if (ad === 'gl') { const g = glSeciliGun(); if (K.glL.imza === null || !K.glL.imza.startsWith('glL|' + g + '|')) { glGoster = BOYUT; setTimeout(() => yukle('glL'), 0); } }
    if (ad === 'gun') { grafik = { bugun: veri.bugun, liste: veri.grafik, zaman: s.zaman }; bolumSayisi = veri.bolumSayisi; }
  } catch (e) {
    if (kontrol !== s.kontrol || n !== nesil) return;
    const hata = e instanceof Hata ? e : new Hata(0, 'ag'), kapat = kapatanMesaj(hata);
    if (kapat) { cik(kapat, true); return; }
    s.hata = hata;
  } finally {
    if (kontrol === s.kontrol) s.surer = false;
  }
  ciz();
}

/* ───────── bağlan / çık ───────── */
const depoOku = () => { try { return localStorage.getItem(DEPO); } catch (e) { return null; } };
const depoYaz = (v) => { try { if (v) localStorage.setItem(DEPO, v); else localStorage.removeItem(DEPO); } catch (e) { /* saklanamıyorsa yalnız bellekte */ } };
function temizle() {                                  // ekrandaki ve bellekteki bütün veriler
  nesil++;
  for (const s of Object.values(K)) { if (s.kontrol) s.kontrol.abort(); Object.assign(s, { imza: null, veri: null, hata: null, zaman: 0, kontrol: null, surer: false }); }
  grafik = null; bolumSayisi = null; clearTimeout(araBekle); clearTimeout(siraBekle);
  donusBekliyor = false; clearTimeout(dugmeBekle); $('yenile').disabled = false;
  if ($('kart').open) $('kart').close(); kartKapandi();
  for (const id of ['rkOzetKutu', 'roGovde', 'roDurum', 'roTahmin', 'kpis', 'kpis2', 'oyKpis', 'ulkeler', 'ulOzet', 'canliListe', 'canliSerit', 'canliOzet', 'adOzetListe', 'adKpis', 'adBars', 'adListe', 'adDugmeler', 'adNot', 'adRozet', 'yeniListe', 'oynListe', 'bars', 'axis', 'seciliOzet', 'huni', 'zor', 'modlar', 'surum', 'siraListe', 'siraSayi', 'yeniDugmeler', 'oynDugmeler', 'siraDugmeler', 'durumYazi', 'uyariYazi', 'glKpis', 'glTablo', 'glListe', 'glDugmeler', 'glDilim', 'rkGovde', 'rkDurum']) { const e = $(id); e.textContent = ''; e._h = undefined; }
  $('ara').value = ''; $('sAra').value = ''; $('yalnizGun').checked = false; $('yalnizYeni').checked = false; $('glOneri').checked = false;
  glAralik = '1'; glGun = null; glGoster = BOYUT; rkAralik = '7'; adGoster = BOYUT; roAralik = '1'; for (const a of Object.keys(sira)) sira[a] = null;
  $('yeniBaslik').textContent = 'İlk kez oynayanlar'; $('oynBaslik').textContent = 'Oynayanlar';
  secili = bugun = yerelGun(); yeniGoster = ILK_YENI; oynGoster = ILK_OYN; siraGoster = ILK_SIRA;
}
function cik(mesaj, unut) {
  temizle(); anahtar = null; if (unut) depoYaz(null);
  $('girisMesaj').textContent = mesaj || ''; $('anahtar').value = ''; $('baglan').disabled = false; $('baglan').textContent = 'Bağlan';
  ciz();
}
async function baglan(deger, sakla) {
  $('girisMesaj').textContent = '';
  const a = deger.trim();
  if (!/^[\x20-\x7e]{1,300}$/.test(a)) { $('girisMesaj').textContent = 'Anahtar yanlış. Türkçe harf ya da görünmeyen karakter olmamalı.'; return; }
  temizle(); anahtar = a; hatirla = sakla;
  $('baglan').disabled = true; $('baglan').textContent = 'Bağlanıyor…';
  const kontrol = new AbortController(), n = nesil, t = K.gun.tanim();
  try {
    const j = await iste(t.yollar[0], kontrol);
    if (n !== nesil) return;
    depoYaz(hatirla ? a : null);
    Object.assign(K.gun, { imza: t.imza, veri: j, zaman: Date.now(), hata: null });
    grafik = { bugun: j.bugun, liste: j.grafik, zaman: K.gun.zaman }; bolumSayisi = j.bolumSayisi;
    $('anahtar').value = ''; $('baglan').disabled = false; $('baglan').textContent = 'Bağlan';
    window.scrollTo(0, 0); sonTur = Date.now(); ciz(); yukle('b30'); yukle('sira'); yukle('gl'); yukle('rk'); yukle('ro'); yukle('ad'); yukle('canli'); yukle('ul');
  } catch (e) {
    if (n !== nesil) return;
    const hata = e instanceof Hata ? e : new Hata(0, 'ag');
    const m = kapatanMesaj(hata) || (hata.durum === 0 ? 'Sunucuya ulaşılamadı. Bilgi alınamadı; internetini kontrol edip tekrar dene.'
      : hata.durum === 404 ? 'Sunucuda pano henüz kurulu değil. Bilgi alınamadı.' : hata.kod === 'veri-yok' ? 'Sunucuda henüz oynama kaydı yok.' : 'Bilgi alınamadı (sunucu hatası ' + hata.durum + '). Biraz sonra tekrar dene.');
    cik(m, hata.durum === 403);
    if (hata.durum !== 403) $('anahtar').value = a;           // ağ / sunucu hatasında yeniden yazdırma
  }
}

/* ───────── yenileme ───────── */
function gunDegisti() {                               // gece yarısı: "bugün" ilerler
  const g = yerelGun(); if (g === bugun) return;
  if (secili === bugun) secili = g; bugun = g;
  if (secili < kaydir(bugun, -GUN_GERI)) secili = kaydir(bugun, -GUN_GERI);
}
// hepsini tazele: gün, sıralama (ilk sayfa), bölümler ve açık listeler
function tazele() {
  if (anahtar === null || oyun !== 'ks') return;
  gunDegisti(); sonTur = Date.now(); donusBekliyor = false;
  for (const [ad, s] of Object.entries(K)) if (s.tanim()) yukle(ad, true);
}
// pano yeniden öne gelince (ana ekrandan / başka sekmeden) ve son tazelemeden en az 2 dakika geçmişse
function geriDonus() {
  if (document.visibilityState !== 'visible' || anahtar === null || !sonTur || Date.now() - sonTur < DONUS_MS) return;
  if (oyun === 'ks') tazele(); else donusBekliyor = true;      // Vapura ekranında istek atılmaz; Knock Shot'a dönünce tazelenir
}

/* ───────── çizim yardımcıları ───────── */
const koy = (id, html) => { const e = $(id); if (e._h !== html) { e.innerHTML = html; e._h = html; } };
const yazi = (id, t) => { const e = $(id); if (e.textContent !== t) e.textContent = t; };
const bekliyor = (s) => (s.hata ? 'Alınamadı.' : 'Yükleniyor…');
const bosLi = (t) => '<li class="bos">' + esc(t) + '</li>';
const bosTr = (n, t) => '<tr><td colspan="' + n + '" class="bos-hucre">' + esc(t) + '</td></tr>';
// küçük çizgi grafik (son 14 gün)
function cizgi(d) {
  if (!d || d.length < 2) return '';
  const mx = Math.max(1, ...d), n = d.length - 1;
  return '<svg class="cizgi" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" points="'
    + d.map((v, i) => (100 * i / n).toFixed(1) + ',' + (27 - 24 * v / mx).toFixed(1)).join(' ') + '"/></svg>';
}
// sayı kutusu. alt: alt satırın HTML'i; sinif: ana | yesil | tam; yaziMi: değer sayı değil yazı; grafikD: küçük çizgi için sayılar
const kutu = (etiket, deger, alt, sinif, yaziMi, grafikD) => '<div class="k ' + (sinif || '') + '">' + (grafikD ? cizgi(grafikD) : '') + '<span class="et">' + etiket + '</span><b' + (yaziMi ? ' class="yazi"' : '') + '>' + deger + '</b><div class="altsatir">' + (alt || '') + '</div></div>';
const kutuBos = (etiket, s, sinif) => kutu(etiket, s.hata ? 'alınamadı' : '…', '', sinif || '', true);
function fark(a, b) {
  if (a === null || b === null || a === undefined || b === undefined) return '';
  const f = a - b;
  if (!f) return '<span class="fark ayni">' + (secili === bugun ? 'dünle aynı' : 'değişmedi') + '</span>';
  return '<span class="fark ' + (f > 0 ? 'art' : 'az') + '" aria-label="bir önceki güne göre ' + fmt(Math.abs(f)) + (f > 0 ? ' fazla' : ' az') + '">' + (f > 0 ? '↑ ' : '↓ ') + fmt(Math.abs(f)) + '</span>';
}
const adYaz = (p) => (p.ad ? esc(p.ad) : '<i>Ad yazmamış oyuncu</i>');
// baş harfli yuvarlak; renk addan türetilir (aynı ad hep aynı renk)
function avatar(ad) {
  if (!ad) return '<span class="av bosav" aria-hidden="true">?</span>';
  let h = 0; for (const c of ad) h = (h * 31 + c.codePointAt(0)) % 360;
  const parca = ad.trim().split(/\s+/), harf = [...ad.replace(/[^\p{L}\p{N}]/gu, '')];
  const y = parca.length > 1 && /^\p{L}/u.test(parca[1]) ? [...parca[0]][0] + [...parca[1]][0] : harf.slice(0, 2).join('');
  return '<span class="av" style="--h:' + h + '" aria-hidden="true">' + esc(y || '?') + '</span>';
}
const bitti = (b) => bolumSayisi && b > bolumSayisi;
const bolumYaz = (b) => (bitti(b) ? 'Hepsini bitirdi' : 'Bölüm ' + fmt(b));
// PANO ÜLKE 1: ülke kodu (2 harf) → bayrak + Türkçe ad. Ad tarayıcının kendi ülke adı listesinden (Intl; dış kütüphane yok).
// Bayrak harfleri yazı tipinde yoksa (Windows masaüstü) bayrak yerine küçük kod rozeti çıkar.
const ULKE_BAS = '27.11';      // sunucu ülkeyi bu günden beri tutuyor (lib/ulke.mjs ULKE_BASLANGIC)
const ULKE_ADI = (() => { try { return new Intl.DisplayNames(['tr'], { type: 'region' }); } catch (e) { return null; } })();
const ULKE_KISA = { US: 'ABD', GB: 'Birleşik Krallık', AE: 'BAE' };      // uzun resmî adların kısası
function ulkeAd(u) { if (!u) return ''; if (ULKE_KISA[u]) return ULKE_KISA[u]; try { return (ULKE_ADI && ULKE_ADI.of(u)) || u; } catch (e) { return u; } }
const BAYRAK_VAR = (() => {
  try {
    const c = document.createElement('canvas'); c.width = c.height = 20; const x = c.getContext('2d'); if (!x) return false;
    x.font = '16px sans-serif'; x.textBaseline = 'top'; x.fillStyle = '#000'; x.fillText('\u{1F1F9}\u{1F1F7}', 0, 0);
    const d = x.getImageData(0, 0, 20, 20).data;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 64 && d[i] - d[i + 2] > 60) return true;      // kırmızı piksel: renkli bayrak çizildi
    return false;
  } catch (e) { return false; }
})();
const bayrak = (u) => (BAYRAK_VAR ? '<span class="bayrak" aria-hidden="true">' + String.fromCodePoint(...[...u].map((h) => 0x1F1A5 + h.charCodeAt(0))) + '</span>' : '<span class="ukod" aria-hidden="true">' + esc(u) + '</span>');
const ulkeYaz = (u) => (u ? '<span class="ulke" title="' + esc(ulkeAd(u)) + '">' + bayrak(u) + '<span class="uad">' + esc(ulkeAd(u)) + '</span></span>' : '');
// liste satırı. sag: sağdaki kısa bilgi (HTML); ayrinti: ad altındaki satır(lar); rozetler: ad yanındaki etiketler; on: sıra numarası; ic: ad satırının yerine geçen HTML
function satir(p, sag, ayrinti, rozetler, on, ic) {
  return '<li><button type="button" class="satir" data-k="' + esc(p.k) + '" data-ad="' + esc(p.ad || '') + '"><span class="sol">' + (on ? '<span class="no">' + on + '</span>' : '') + avatar(p.ad) + '</span><span class="orta">'
    + (ic || '<span class="adsat"><span class="ad">' + adYaz(p) + '</span>' + (p.kod ? '<span class="kod">#' + esc(p.kod) + '</span>' : '') + ulkeYaz(p.ulke) + (rozetler || '') + '</span>')
    + (ayrinti ? '<span class="ayrinti">' + ayrinti + '</span>' : '') + '</span><span class="sag">' + (sag || '') + '</span><span class="ok" aria-hidden="true">›</span></button></li>';
}
const sagBolum = (bolum, yildiz) => (bolum === null || bolum === undefined ? '' : '<span>' + bolumYaz(bolum) + '</span>') + (yildiz === null || yildiz === undefined ? '' : '<small>★ ' + fmt(yildiz) + '</small>');
const YENI = '<span class="yeni">YENİ</span>';
function oyuncuSatiri(p, rozet) {
  const alt = [fmt(p.oynanan) + ' bölüm oynadı', p.kaldigiYer === null ? 'yalnız öteki modlar' : bitti(p.kaldigiYer) ? 'hepsini bitirdi' : 'kaldığı yer: Bölüm ' + p.kaldigiYer, 'sürüm ' + esc(p.surum)].join(' · ');
  return satir(p, sagBolum(p.ulastigiBolum, p.yildiz), '<span>' + alt + '</span>', rozet ? YENI : '');
}
const dugme = (is, t) => '<button type="button" class="dugme tumu" data-is="' + is + '">' + t + '</button>';
const gunAd = (g, b) => (g === b ? 'Bugün' : g === kaydir(b, -1) ? 'Dün' : kisa(g));
const sayiYaz = (n) => (n === null || n === undefined ? '–' : fmt(n));

/* ───────── sıralama (başlığa / düğmeye basınca; yalnız ekrandaki satırlar yeniden dizilir, sunucuya istek yok) ───────── */
const SIRA = {      // liste → seçenekler: [alan, etiket, ilk yön (-1: büyükten küçüğe)]
  gl: [['zaman', 'Kayıt saati', -1], ['bolum', 'Bölüm', -1], ['yildiz', 'Yıldız', -1], ['ad', 'Ad', 1], ['ulke', 'Ülke', 1]],
  yeni: [['oynanan', 'Oynadığı', -1], ['ulastigiBolum', 'Bölüm', -1], ['yildiz', 'Yıldız', -1], ['ad', 'Ad', 1], ['ulke', 'Ülke', 1]],
  oyn: [['oynanan', 'Oynadığı', -1], ['ulastigiBolum', 'Bölüm', -1], ['yildiz', 'Yıldız', -1], ['ad', 'Ad', 1], ['ulke', 'Ülke', 1]],
  huni: [['bolum', '', 1], ['oynayan', '', -1], ['kazanmaYuzde', '', 1], ['birakan', '', -1], ['ortYildiz', '', -1]],
  ulk: [['ad', '', 1], ['toplam', '', -1], ['aktif7', '', -1]]      // PANO ÜLKE 1: Ülkeler tablosu (başlığa bas)
};
let canliOnceki = null, canliVeri = null;      // şu an oyunda: bir önceki okumadaki oyuncu → bölüm
const sira = { gl: null, yeni: null, oyn: null, huni: null, ulk: null };      // null: sunucunun verdiği sıra
function siraUygula(ad, l) {
  const s = sira[ad]; if (!s) return l;
  const deger = (p) => (s.alan === 'zaman' ? (p.kayitGunu || '') + ' ' + (p.saat || '') : s.alan === 'ulke' ? ulkeAd(p.ulke) : p[s.alan]);      // ülke: Türkçe ada göre; ülkesi olmayan sonda
  return l.slice().sort((a, b) => { const x = deger(a), y = deger(b);
    if (x === null || x === undefined || x === '') return y === null || y === undefined || y === '' ? 0 : 1;      // boşlar hep sonda
    if (y === null || y === undefined || y === '') return -1;
    return s.yon * (typeof x === 'string' ? x.localeCompare(y, 'tr') : x - y); });
}
function siraCubugu(ad) {
  const s = sira[ad];
  koy(ad + 'Sira', '<span>Sırala:</span>' + SIRA[ad].map(([alan, etiket]) => '<button type="button" data-sira="' + ad + ':' + alan + '" aria-pressed="' + !!(s && s.alan === alan) + '">' + etiket + (s && s.alan === alan ? (s.yon < 0 ? ' ↓' : ' ↑') : '') + '</button>').join(''));
}
function siraSec(ad, alan) {
  const s = sira[ad], t = SIRA[ad].find((x) => x[0] === alan); if (!t) return;
  sira[ad] = s && s.alan === alan ? { alan, yon: -s.yon } : { alan, yon: t[2] };
  ciz();
}

/* ───────── genel bakış ───────── */
function ozetCiz() {
  const s = K.gun, v = s.veri, bugunMu = secili === bugun;
  yazi('gunBaslik', bugunMu ? 'Bugün · ' + uzun(secili) : uzun(secili));
  yazi('okNot', bugunMu ? 'Oklar dünle farkı gösterir. Bugün henüz bitmedi.' : 'Oklar bir önceki günle farkı gösterir.');
  const a = v && v.ozet, d = v && v.onceki, g = grafik && grafik.bugun === bugun ? grafik.liste : null;
  const etiket = [bugunMu ? 'Bugün oynayan' : 'O gün oynayan', 'İlk kez oynayan', 'Geri gelen', 'Oynanan bölüm', 'Kazanma oranı', bugunMu ? 'Toplam oyuncu' : 'O güne kadar toplam'];
  if (!a) koy('kpis', etiket.map((e, i) => kutuBos(e, s, i ? '' : 'ana')).join(''));
  else {
    const oranFark = a.kazanmaYuzde === null || d.kazanmaYuzde === null ? '' : fark(a.kazanmaYuzde, d.kazanmaYuzde) + (a.kazanmaYuzde === d.kazanmaYuzde ? '' : '<span>' + (bugunMu ? 'dün' : 'önceki gün') + ' %' + d.kazanmaYuzde + '</span>');
    koy('kpis', kutu(etiket[0], fmt(a.oynayan), fark(a.oynayan, d.oynayan), 'ana', false, g && g.map((x) => x.oynayan)) + kutu(etiket[1], fmt(a.yeni), fark(a.yeni, d.yeni), 'yesil', false, g && g.map((x) => x.yeni))
      + kutu(etiket[2], fmt(a.geriGelen), fark(a.geriGelen, d.geriGelen)) + kutu(etiket[3], fmt(a.oynananBolum), fark(a.oynananBolum, d.oynananBolum))
      + kutu(etiket[4], yuzde(a.kazanmaYuzde), oranFark) + kutu(etiket[5], fmt(a.toplamOyuncu), fark(a.toplamOyuncu, d.toplamOyuncu)));
  }
  // Oyuncular sekmesi: aktif + toplam (her zaman BUGÜNE göre; seçili günden bağımsız)
  const gn = v && v.genel;
  koy('oyKpis', gn ? kutu('Aktif oyuncu · son 3 gün', fmt(gn.aktif3), '<span>bugün dahil, en az bir bölüm oynayan</span>', 'ana') + kutu('Aktif oyuncu · son 7 gün', fmt(gn.aktif7))
      + kutu('Toplam kayıtlı oyuncu', fmt(gn.kayitli), '<span>tüm zamanlar · oyunu açıp ad alan herkes</span>') + kutu('Oynanış verisi paylaşan', fmt(gn.veriPaylasan), '<span>aktif sayıları bunlardan hesaplanır</span>')
    : kutuBos('Aktif oyuncu · son 3 gün', s, 'ana') + kutuBos('Aktif oyuncu · son 7 gün', s) + kutuBos('Toplam kayıtlı oyuncu', s) + kutuBos('Oynanış verisi paylaşan', s));
  // ikinci sıra: kayıt + isim (her zaman BUGÜN, Türkiye saati; seçili günden bağımsız)
  const gl = K.gl.veri, gb = gl && gl.gunler.find((x) => x.gun === gl.bugun), gd = gl && gl.gunler.find((x) => x.gun === kaydir(gl.bugun, -1)), ad = K.ad.veri;
  const cn = K.canli.veri, pencere = cn ? (cn.saatDk % 60 ? cn.saatDk + ' dk' : cn.saatDk / 60 + ' saat') : '5 saat';
  const canliKutu = cn ? kutu('<i class="nabiz"></i>Şu an oyunda', fmt(cn.simdiOyunda), '<span>son ' + cn.yakinDk + ' dk · son ' + pencere + 'te ' + fmt(cn.sonSaat) + '</span>', 'canli') : kutuBos('<i class="nabiz"></i>Şu an oyunda', K.canli, 'canli');
  const once = (dk) => (dk < 1 ? 'şimdi' : dk < 60 ? dk + ' dk önce' : Math.floor(dk / 60) + ' sa ' + (dk % 60 ? (dk % 60) + ' dk ' : '') + 'önce');
  if (cn) {
    // bir önceki okumaya göre: yeni görünen ya da bölüm atlayan satır kısa süre parlar
    const onceki = canliOnceki, simdiki = new Map(cn.liste.map((p) => [p.k, p.bolum]));
    const cl = cn.liste.map((p) => {
      const oyunda = p.dakikaOnce < cn.yakinDk, eski = onceki ? onceki.get(p.k) : undefined, atladi = !!onceki && eski !== undefined && p.bolum > eski, geldi = !!onceki && eski === undefined;
      const rozet = (oyunda ? '<span class="yeni oyunda"><i class="nabiz"></i>OYUNDA</span>' : '') + (atladi ? '<span class="cip atladi">Bölüm ' + eski + ' → ' + p.bolum + '</span>' : '') + (p.bolum <= 1 ? '<span class="oneri">yeni kayıt</span>' : '');
      const yas = oyunda ? 'taze' : p.dakikaOnce < 60 ? 'yakin' : p.dakikaOnce < 180 ? 'orta' : 'eski';
      return satir(p, sagBolum(p.bolum, p.yildiz), '<span>' + (oyunda ? (p.dakikaOnce < 1 ? 'şu an bölüm geçti' : p.dakikaOnce + ' dk önce bölüm geçti') : once(p.dakikaOnce)) + '</span>', rozet).replace('<li>', '<li class="cl ' + yas + (atladi || geldi ? ' parla' : '') + '">');
    }).join('');
    if (K.canli.veri !== canliVeri) { canliVeri = K.canli.veri; canliOnceki = simdiki; }
    koy('canliListe', cl || bosLi('Son ' + pencere + 'te kaydolan ya da bölüm geçen yok.'));
    // etkinlik şeridi: 15 dakikalık dilimler, en sağ = şimdi
    const d = cn.dilimler || [], mx = Math.max(1, ...d), G = 14, B = 3, Y = 56;
    koy('canliSerit', d.length ? '<svg viewBox="0 0 ' + (d.length * (G + B) - B) + ' ' + Y + '" preserveAspectRatio="none" role="img" aria-label="Son ' + pencere + 'teki hareket">' + d.map((n, x) => { const h = n ? Math.max(4, Math.round(n / mx * (Y - 4))) : 2; return '<rect class="' + (x === d.length - 1 ? 'son' : n ? 'dolu' : 'bos') + '" x="' + x * (G + B) + '" y="' + (Y - h) + '" width="' + G + '" height="' + h + '" rx="3"><title>' + ((d.length - 1 - x) * cn.dilimDk) + ' dk önce: ' + n + ' kişi</title></rect>'; }).join('') + '</svg><div class="serit-alt"><span>' + pencere + ' önce</span><span>en yoğun 15 dk: ' + fmt(mx) + ' kişi</span><span>şimdi</span></div>' : '');
    koy('canliOzet', '<div class="buyuk"><i class="nabiz"></i><b>' + fmt(cn.simdiOyunda) + '</b><span>şu an oyunda</span></div><div class="kucuk"><b>' + fmt(d.slice(-4).reduce((a, b) => a + b, 0)) + '</b><span>son 1 saatte</span></div><div class="kucuk"><b>' + fmt(cn.sonSaat) + '</b><span>son ' + pencere + 'te</span></div>');
    yazi('canliSaat', 'canlı · 30 sn’de bir yenilenir');
  } else { koy('canliListe', bosLi(bekliyor(K.canli))); koy('canliSerit', ''); koy('canliOzet', ''); yazi('canliSaat', ''); }
  yazi('canliBaslik', 'Şu an oyunda');
  koy('kpis2', canliKutu + (gb ? kutu('Yeni kayıt · bugün', fmt(gb.yeniKayit), gd ? '<span>dün ' + fmt(gd.yeniKayit) + '</span>' : '') + kutu('İlk skorunu yazan · bugün', fmt(gb.ilkSkor), gb.yeniKayit ? '<span>yeni kayıtların %' + Math.round(100 * gb.ilkSkor / gb.yeniKayit) + '’i</span>' : '')
      : kutuBos('Yeni kayıt · bugün', K.gl) + kutuBos('İlk skorunu yazan · bugün', K.gl))
    + (ad ? kutu('İsim değiştiren · bugün', fmt(ad.ozet.bugun.kisi), '<span>dün ' + fmt(ad.ozet.dun.kisi) + '</span>') + kutu('İsim değişikliği · 7 gün', fmt(ad.ozet.yedi.degisiklik), '<span>30 günde ' + fmt(ad.ozet.otuz.degisiklik) + '</span>')
      : kutuBos('İsim değiştiren · bugün', K.ad) + kutuBos('İsim değişikliği · 7 gün', K.ad)));
}
// listede gösterilecek veri: ilk sayfa gün özetinden, fazlası / arama ayrı kaynaktan
function listeDurumu(ad, ilkAlan) {
  const t = K[ad].tanim();
  if (!t) return { s: K.gun, v: K.gun.veri && K.gun.veri[ilkAlan] };
  const s = K[ad];
  if (s.veri) return { s, v: s.veri };
  const ara = ad === 'oyn' && $('ara').value.trim();
  return { s, v: !ara && K.gun.veri ? K.gun.veri[ilkAlan] : null, bekle: true };      // "daha fazla" yüklenirken eldeki ilk sayfa durur
}
function listeCiz(ad, ilkAlan, onEk, goster, ilk, baslikBugun, baslik, bosYazi, rozet) {
  const { s, v, bekle } = listeDurumu(ad, ilkAlan), ara = ad === 'oyn' && $('ara').value.trim();
  const toplam = K.gun.veri ? K.gun.veri[ilkAlan].toplam : null;
  yazi(onEk + 'Baslik', (secili === bugun ? baslikBugun : baslik + ' · ' + kisa(secili)) + (toplam === null ? '' : ' (' + fmt(toplam) + ')'));
  if (!v) { koy(onEk + 'Liste', bosLi(bekliyor(s))); koy(onEk + 'Dugmeler', ''); return; }
  const l = siraUygula(ad, v.liste.slice(0, goster)); siraCubugu(ad);
  koy(onEk + 'Liste', l.map((p) => oyuncuSatiri(p, rozet && p.yeni)).join('') || bosLi(ara ? 'Bulunamadı.' : bosYazi));
  let d = '';
  if (bekle || (goster > v.liste.length && v.liste.length < v.toplam && (s.surer || s.hata))) d = '<p class="note ara-durum">' + (s.hata ? 'Gerisi alınamadı.' : 'Yükleniyor…') + '</p>';
  else if (l.length < v.toplam) d = dugme(ad + '-fazla', 'Daha fazla göster (' + fmt(l.length) + ' / ' + fmt(v.toplam) + ')');
  const kisaHal = ara ? BOYUT : ilk;
  if (goster > kisaHal && v.toplam > kisaHal) d += dugme(ad + '-kisalt', 'Kısalt');
  koy(onEk + 'Dugmeler', d);
}
function grafikCiz() {
  const g = grafik && grafik.bugun === bugun ? grafik.liste : null;
  if (!g) { koy('bars', '<p class="bos">' + bekliyor(K.gun) + '</p>'); koy('axis', ''); yazi('seciliOzet', ''); return; }
  const mx = Math.max(1, ...g.map((x) => x.oynayan));
  koy('bars', g.map((x) => '<button type="button" class="bar' + (x.gun === bugun ? ' bugun' : '') + (x.gun === secili ? ' sec' : '') + '" data-g="' + x.gun + '" aria-pressed="' + (x.gun === secili) + '" title="' + kisa(x.gun) + ': ' + x.oynayan + ' oynayan, ' + x.yeni + ' yeni" aria-label="' + kisa(x.gun) + ': ' + x.oynayan + ' oynayan, ' + x.yeni + ' yeni gelen"><em>' + x.oynayan + '</em><span class="govde" style="height:' + Math.round(84 * x.oynayan / mx) + '%"><b style="height:' + Math.round(100 * x.yeni / Math.max(1, x.oynayan)) + '%"></b></span></button>').join(''));
  koy('axis', g.map((x) => '<span>' + Number(x.gun.slice(8)) + '</span>').join(''));
  const o = K.gun.veri && K.gun.veri.ozet;
  koy('seciliOzet', o ? esc(kisa(secili)) + ': ' + fmt(o.oynayan) + ' oynayan, <span class="yesil-yazi">' + fmt(o.yeni) + ' ilk kez oynayan</span>' : esc(kisa(secili) + ': ' + bekliyor(K.gun)));
}
// PANO ÜLKE 1: Genel > Ülkeler. Varsayılan: en çok oyuncudan aza (sunucu sırası); başlığa basınca ülke / oyuncu / aktif'e göre. "Diğer" hep sonda.
function ulkeCiz() {
  const v = K.ul.veri;
  if (!v) { koy('ulkeler', bosTr(3, bekliyor(K.ul))); koy('ulOzet', ''); return; }
  const l = siraUygula('ulk', v.ulkeler.map((x) => ({ ...x, ad: ulkeAd(x.ulke) }))), mx = Math.max(1, ...v.ulkeler.map((x) => x.toplam));
  document.querySelectorAll('[data-sira^="ulk:"]').forEach((b) => { const a = b.dataset.sira.slice(4), h = sira.ulk; b.dataset.yon = h && h.alan === a ? (h.yon < 0 ? '↓' : '↑') : ''; });
  const yuzde = (n) => (v.toplam ? ' <small>%' + Math.round((100 * n) / v.toplam) + '</small>' : '');
  koy('ulkeler', l.map((x) => '<tr><td class="sol">' + ulkeYaz(x.ulke) + '</td><td><span class="meter" style="--p:' + (x.toplam / mx).toFixed(3) + '"></span>' + fmt(x.toplam) + yuzde(x.toplam) + '</td><td>' + fmt(x.aktif7) + '</td></tr>').join('')
    + (v.diger.ulkeSayisi ? '<tr class="diger"><td class="sol">Diğer · ' + fmt(v.diger.ulkeSayisi) + ' ülke</td><td>' + fmt(v.diger.toplam) + yuzde(v.diger.toplam) + '</td><td>' + fmt(v.diger.aktif7) + '</td></tr>' : '')
    || bosTr(3, 'Henüz ülkesi bilinen oyuncu yok.'));
  koy('ulOzet', v.toplam ? fmt(v.toplam) + ' oyuncu · ' + fmt(v.ulkeSayisi) + ' ülke · son 7 günde ' + fmt(v.aktif7) + ' aktif' : '');
}
function modCiz() {
  yazi('modBaslik', 'Modlar · ' + (secili === bugun ? 'bugün' : kisa(secili)));
  const v = K.gun.veri; if (!v) { koy('modlar', bosTr(3, bekliyor(K.gun))); return; }
  const mx = Math.max(1, ...v.modlar.map((x) => x.oynayan));
  koy('modlar', v.modlar.map((x) => '<tr><td>' + esc(MODLAR[x.mod] || x.mod) + '</td><td><span class="meter" style="--p:' + (x.oynayan / mx).toFixed(3) + '"></span>' + fmt(x.oynayan) + ' kişi</td><td>' + fmt(x.oynananBolum) + '</td></tr>').join(''));
}
const oran = (y) => (y === null || y === undefined ? '–' : '<span class="oran ' + (y >= 70 ? 'iyi' : y >= 40 ? 'orta' : 'kotu') + '">%' + y + '</span>');
function bolumCiz() {
  const gunluk = $('yalnizGun').checked, s = gunluk ? K.bGun : K.b30;
  yazi('huniNot', (gunluk ? kisa(secili) : 'Son 30 gün') + ' · normal mod. Her bölümü kaç kişi oynadı?');
  if (!s.veri) koy('huni', bosTr(5, bekliyor(s)));
  else {
    const l = siraUygula('huni', s.veri.bolumler), mx = Math.max(1, ...l.map((x) => x.oynayan));
    document.querySelectorAll('[data-sira^="huni:"]').forEach((b) => { const a = b.dataset.sira.slice(5), h = sira.huni; b.dataset.yon = h && h.alan === a ? (h.yon < 0 ? '↓' : '↑') : ''; });
    koy('huni', l.map((x) => '<tr><td>' + x.bolum + '</td><td><span class="meter" style="--p:' + (x.oynayan / mx).toFixed(3) + '"></span>' + fmt(x.oynayan) + '</td><td>' + oran(x.kazanmaYuzde) + '</td><td>' + (x.birakan ? fmt(x.birakan) + ' kişi' : '–') + '</td><td>' + ondalik(x.ortYildiz) + '</td></tr>').join('') || bosTr(5, gunluk ? 'Bu gün oynanan yok.' : 'Henüz oynanan yok.'));
  }
  const v = K.b30.veri;
  if (!v) { koy('zor', bosTr(4, bekliyor(K.b30))); koy('surum', bosTr(3, bekliyor(K.b30))); return; }
  koy('zor', v.zor.map((x) => '<tr><td>' + x.bolum + '</td><td>' + fmt(x.deneme) + '</td><td>' + oran(x.kazanmaYuzde) + '</td><td>' + ondalik(x.ortKalanTop) + '</td></tr>').join('') || bosTr(4, 'Henüz yeterince oynanmadı.'));
  const smx = Math.max(1, ...v.surumler.map((x) => x.oyuncu));
  koy('surum', v.surumler.map((x) => '<tr><td>' + esc(x.surum) + '</td><td><span class="meter" style="--p:' + (x.oyuncu / smx).toFixed(3) + '"></span>' + fmt(x.oyuncu) + '</td><td>' + fmt(x.oynananBolum) + '</td></tr>').join('') || bosTr(3, 'Henüz oynanan yok.'));
}
function siraCiz() {
  const s = K.sira, v = s.veri, ara = $('sAra').value.trim(), yeni = $('yalnizYeni').checked;
  yazi('siraSayi', v ? '· ' + fmt(v.toplamAdli) + ' oyuncu' : '');
  if (!v) { koy('siraListe', bosLi(bekliyor(s))); koy('siraDugmeler', ''); return; }
  const l = v.liste.slice(0, siraGoster);
  koy('siraListe', l.map((p) => satir(p, sagBolum(p.bolum, p.yildiz), '<span>ilk gelişi: ' + (p.ilkGun ? kisa(p.ilkGun) : 'kayıt yok') + '</span>', p.yeni ? YENI : '', p.sira ? p.sira : '')).join('')
    || bosLi(ara ? 'Bulunamadı.' : yeni ? 'Bu gün ad yazan yeni oyuncu yok.' : 'Henüz ad yazan yok.'));
  const daha = l.length < v.liste.length || v.dahaVar;
  let d = '';
  if (s.surer && siraGoster > v.liste.length) d = '<p class="note ara-durum">Yükleniyor…</p>';
  else if (s.hata && siraGoster > v.liste.length) d = '<p class="note ara-durum">Gerisi alınamadı.</p>';
  else if (daha) d = dugme('sira-fazla', 'Daha fazla göster (' + fmt(l.length) + ' / ' + fmt(v.toplam) + ')');
  else if (!ara && !yeni && v.toplam > l.length) d = '<p class="note ara-durum">Sonrası için aramayı kullan.</p>';
  if (siraGoster > ILK_SIRA && v.toplam > ILK_SIRA) d += dugme('sira-kisalt', 'Kısalt');
  koy('siraDugmeler', d);
}
/* ───────── yeni kayıtlar (Gelenler) ───────── */
function gelenlerCiz() {
  document.querySelectorAll('[data-gl]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.gl === glAralik)));
  const s = K.gl, v = s.veri;
  yazi('glDilim', v ? '· günler ' + v.saatDilimi : '');
  if (!v) { koy('glKpis', ''); koy('glTablo', bosTr(5, bekliyor(s))); $('glTabloKutu').hidden = false; koy('glListe', ''); koy('glDugmeler', ''); yazi('glListeBaslik', 'Yeni oyuncular'); return; }
  const tekGun = glAralik === '1' || glAralik === 'd', g0 = glSeciliGun(), t0 = v.gunler.find((x) => x.gun === g0);
  const t = tekGun ? t0 : Object.assign({ oynayan: null }, v.toplam);
  koy('glKpis', kutu('Yeni kayıt', fmt(t.yeniKayit), '', 'yesil') + kutu('İlk skorunu yazan', fmt(t.ilkSkor), t.yeniKayit ? '<span>%' + Math.round(100 * t.ilkSkor / t.yeniKayit) + '</span>' : '')
    + (tekGun ? kutu('O gün oynayan', sayiYaz(t.oynayan)) : kutu('Gün', fmt(v.gunler.length))) + kutu('Kendi adını yazan', fmt(t.yeniKayit - t.oneriAd), '<span>' + fmt(t.oneriAd) + ' kişi önerilen adla</span>'));
  $('glTabloKutu').hidden = tekGun;
  koy('glTablo', v.gunler.map((x) => '<tr' + (x.gun === g0 ? ' class="sec"' : '') + '><td><button type="button" class="gun-dugme" data-glg="' + x.gun + '" aria-pressed="' + (x.gun === g0) + '">' + esc(gunAd(x.gun, v.bugun)) + '</button></td><td>' + fmt(x.yeniKayit) + '</td><td>' + fmt(x.ilkSkor) + '</td><td>' + sayiYaz(x.oynayan) + '</td><td>' + fmt(x.oneriAd) + '</td></tr>').join(''));
  const l = K.glL, lv = l.veri, ek = g0 === v.bugun || g0 === kaydir(v.bugun, -1) ? ' · ' + kisa(g0) : '';
  yazi('glListeBaslik', 'Yeni oyuncular · ' + gunAd(g0, v.bugun) + ek + (lv ? ' (' + fmt(lv.toplam) + ')' : ''));
  if (!v.kayitTablosu) { koy('glListe', bosLi('Sunucuda henüz ad#kod kaydı yok.')); koy('glDugmeler', ''); return; }
  if (!lv) { koy('glListe', bosLi(bekliyor(l))); koy('glDugmeler', ''); return; }
  const gor = siraUygula('gl', lv.liste.slice(0, glGoster)); siraCubugu('gl');
  const ilkIc = (p) => (p.ilkAd ? '<span class="degisim"><span class="eski">' + esc(p.ilkAd) + '</span><span class="okk" aria-label="şimdiki adı">→</span><span class="yeniad">' + adYaz(p) + '</span>' + (p.kod ? '<span class="kod">#' + esc(p.kod) + '</span>' : '') + '<span class="cip">adını değiştirdi</span></span>' : '');
  koy('glListe', gor.map((p) => satir(p, sagBolum(p.bolum, p.yildiz || null), '<span>' + esc(p.saat) + ' · sürüm ' + (p.surum ? esc(p.surum) : '–') + (p.adDegisim > 1 ? ' · ' + p.adDegisim + ' kez ad değiştirdi' : '') + '</span>'
    + (p.dizineSonra ? '<span>Kaydı ' + esc(kisa(p.kayitGunu)) + ', ad#kod bu gün verildi</span>' : ''), p.oneriAd ? '<span class="oneri" title="Adını hiç değiştirmemiş">önerilen ad</span>' : '', '', ilkIc(p))).join('')
    || bosLi($('glOneri').checked ? 'Bu gün adını değiştirmeyen yeni oyuncu yok.' : 'Bu gün yeni kayıt yok.'));
  let d = '';
  if (glGoster > lv.liste.length && lv.liste.length < lv.toplam && (l.surer || l.hata)) d = '<p class="note ara-durum">' + (l.hata ? 'Gerisi alınamadı.' : 'Yükleniyor…') + '</p>';
  else if (gor.length < lv.toplam) d = dugme('gl-fazla', 'Daha fazla göster (' + fmt(gor.length) + ' / ' + fmt(lv.toplam) + ')');
  if (glGoster > BOYUT) d += dugme('gl-kisalt', 'Kısalt');
  koy('glDugmeler', d);
}

/* ───────── PANO 2: isim değişiklikleri ───────── */
function adSatiri(p, b) {
  const ic = '<span class="degisim"><span class="eski">' + esc(p.eski) + '</span><span class="okk" aria-label="yeni adı">→</span><span class="yeniad">' + esc(p.yeni) + '</span>' + (p.kod ? '<span class="kod">#' + esc(p.kod) + '</span>' : '') + '</span>';
  const alt = [gunAd(p.gun, b) + ' ' + esc(p.saat), p.simdikiAd && p.simdikiAd !== p.yeni ? 'şimdiki adı: ' + esc(p.simdikiAd) : null].filter(Boolean).join(' · ');
  return satir({ k: p.k, ad: p.simdikiAd || p.yeni }, sagBolum(p.bolum, p.yildiz), '<span>' + alt + '</span>', '', '', ic);
}
function adCiz() {
  const s = K.ad, v = s.veri, r = $('adRozet');
  r.hidden = !(v && v.ozet.bugun.degisiklik); if (v) yazi('adRozet', fmt(v.ozet.bugun.degisiklik));
  if (!v) { koy('adKpis', ''); koy('adBars', '<p class="bos">' + bekliyor(s) + '</p>'); koy('adListe', bosLi(bekliyor(s))); koy('adOzetListe', bosLi(bekliyor(s))); koy('adDugmeler', ''); yazi('adNot', ''); return; }
  const o = v.ozet, kisi = (x) => '<span>' + fmt(x.kisi) + ' kişi</span>';
  yazi('adNot', (v.ilkKayit ? 'Kayıt ' + kisa(v.ilkKayit) + ' gününden beri tutuluyor' : 'Kayıt yeni başladı; henüz değişiklik yok') + ' · daha eski değişiklikler sunucuda saklanmadı · saatler ' + v.saatDilimi + '.');
  koy('adKpis', kutu('Bugün', fmt(o.bugun.degisiklik), kisi(o.bugun), 'ana') + kutu('Dün', fmt(o.dun.degisiklik), kisi(o.dun)) + kutu('Son 7 gün', fmt(o.yedi.degisiklik)) + kutu('Son 30 gün', fmt(o.otuz.degisiklik), '<span>toplam ' + fmt(v.toplam) + ' · ' + fmt(v.kisi) + ' oyuncu</span>'));
  const mx = Math.max(1, ...v.gunler.map((x) => x.degisiklik));
  koy('adBars', v.gunler.map((x) => '<i class="' + (x.degisiklik ? '' : 'sifir') + '" style="height:' + Math.max(2, Math.round(100 * x.degisiklik / mx)) + '%" title="' + kisa(x.gun) + ': ' + x.degisiklik + ' değişiklik"></i>').join(''));
  yazi('adBaslik', 'Kim, adını neyle değiştirdi' + (v.toplam ? ' (' + fmt(v.toplam) + ')' : ''));
  const gor = v.liste.slice(0, adGoster);
  koy('adListe', gor.map((p) => adSatiri(p, v.bugun)).join('') || bosLi('Henüz isim değiştiren yok. Bir oyuncu adını değiştirdiğinde eski ve yeni adı burada görünür.'));
  koy('adOzetListe', v.liste.slice(0, 6).map((p) => adSatiri(p, v.bugun)).join('') || bosLi('Henüz isim değiştiren yok.'));
  let d = '';
  if (adGoster > v.liste.length && v.liste.length < v.toplam && (s.surer || s.hata)) d = '<p class="note ara-durum">' + (s.hata ? 'Gerisi alınamadı.' : 'Yükleniyor…') + '</p>';
  else if (gor.length < v.toplam) d = dugme('ad-fazla', 'Daha fazla göster (' + fmt(gor.length) + ' / ' + fmt(v.toplam) + ')');
  if (adGoster > BOYUT) d += dugme('ad-kisalt', 'Kısalt');
  koy('adDugmeler', d);
}

/* ───────── PANO GELENLER 1: Apple Ads ───────── */
const para = (x, p) => (x === null || x === undefined ? '–' : x.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (p ? ' ' + esc(p) : ''));
const HATA_RK = { 'belirtec-401': 'Apple anahtarı kabul etmedi (kimlikleri kontrol et).', 'ozel-anahtar-bicim': 'Özel anahtar biçimi okunamadı.', 'hesap-yok': 'Bu anahtarla org <GİZLİ> görünmüyor.' };
function reklamTablo(bas, satirlar, ilk) {
  return '<div class="scroll"><table class="rk"><thead><tr><th>' + bas + '</th><th>Harcama</th><th>Gösterim</th><th>Dokunma</th><th>İndirme</th><th>İndirme başı</th></tr></thead><tbody>'
    + (satirlar.map((x) => '<tr><td class="sol">' + ilk(x) + '</td><td>' + para(x.harcama) + '</td><td>' + fmt(x.gosterim) + '</td><td>' + fmt(x.dokunma) + '</td><td>' + fmt(x.indirme) + '</td><td>' + para(x.indirmeBasi) + '</td></tr>').join('') || bosTr(6, 'Bu aralıkta veri yok.')) + '</tbody></table></div>';
}
function reklamCiz() {
  document.querySelectorAll('[data-rk]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.rk === rkAralik)));
  const s = K.rk, v = s.veri;
  if (!v) { yazi('rkDurum', ''); koy('rkGovde', '<p class="bos">' + bekliyor(s) + '</p>'); return; }
  if (!v.bagli) { yazi('rkDurum', '· bağlı değil');
    koy('rkGovde', '<p class="para-bos">Bağlı değil.</p><p class="note">Sunucuda Apple Ads API anahtarları tanımlı değil (eksik: ' + v.eksik.map(esc).join(', ') + '). Kurulum: ONUR-APPLE-ADS-ADIMLAR.md. O zamana kadar sayılar <a href="https://app-ads.apple.com/cm/app/<GİZLİ>/report" target="_blank" rel="noopener noreferrer">Apple Ads raporunda</a>.</p>'); return; }
  if (!v.veri) { yazi('rkDurum', '· bağlı, veri yok');
    koy('rkGovde', '<p class="para-bos">Henüz veri yok.</p><p class="note">' + (v.sonSonuc && v.sonSonuc !== 'ok' ? 'Son çekim başarısız: ' + esc(HATA_RK[v.sonSonuc] || v.sonSonuc) : 'Sunucu günde bir kez çeker; ilk çekim bekleniyor.') + '</p>'); return; }
  yazi('rkDurum', '· son çekim ' + kisa(v.sonCekim.slice(0, 10)) + ' ' + saatYaz(Date.parse(v.sonCekim)));
  const t = v.toplam;
  koy('rkGovde', '<div class="kpis bes">' + kutu('Harcama', para(t.harcama, t.para), '', '', true) + kutu('Gösterim', fmt(t.gosterim)) + kutu('Dokunma', fmt(t.dokunma), t.dokunmaOran !== null ? '<span>%' + String(t.dokunmaOran).replace('.', ',') + '</span>' : '')
    + kutu('İndirme', fmt(t.indirme), '<span>dokunarak ' + fmt(t.indirmeDokunma) + '</span>', 'yesil') + kutu('İndirme başı maliyet', para(t.indirmeBasi, t.para), '', '', true) + '</div>'
    + '<h4>Gün gün' + (t.para ? ' <span class="dur">(' + esc(t.para) + ')</span>' : '') + '</h4>' + reklamTablo('Gün', v.gunler, (x) => esc(gunAd(x.gun, v.gune)))
    + '<h4>Kampanyalar</h4>' + reklamTablo('Kampanya', v.kampanyalar, (x) => esc(x.ad || x.kampanya))
    + '<h4>Anahtar kelimeler</h4>' + reklamTablo('Kelime', v.kelimeler, (x) => '<b>' + esc(x.metin) + '</b><span class="dur"> · ' + esc(x.eslesme === 'EXACT' ? 'tam' : x.eslesme === 'BROAD' ? 'geniş' : x.eslesme) + ' · ' + esc(x.kampanya) + '</span>')
    + '<p class="note alt-not">Günler Apple Ads hesabının saat dilimine göre. İndirme = Apple’ın toplam indirme sayısı (dokunarak + görüntüleyerek). Kaynak: Apple Ads API, sunucu günde bir kez çeker.</p>');
}

/* ───────── REKLAM KAYDI 1: oyundaki reklamlar ───────── */
const ECPM = 'vy_pano_ecpm';                           // yalnız bu cihaz (localStorage); sunucuya GİTMEZ
// Başlangıç değeri: <GİZLİ> (gerçek gelir sayıları paylaşım paketinden çıkarıldı). Kendi AdMob raporundaki bin gösterim kazancını buraya ya da kutuya yaz.
const ECPM_VARSAYILAN = { gecis: '', odullu: '' };
const ecpmOku = () => { try { const v = JSON.parse(localStorage.getItem(ECPM) || 'null'); return v && typeof v === 'object' ? v : ECPM_VARSAYILAN; } catch (e) { return ECPM_VARSAYILAN; } };
const ecpmSayi = (s) => { const t = String(s || '').trim().replace(/\s/g, '').replace(',', '.'); if (!t || !/^\d{0,6}(\.\d{0,4})?$/.test(t)) return null; const n = Number(t); return Number.isFinite(n) && n >= 0 ? n : null; };
const yzd = (x) => (x === null || x === undefined ? '–' : '%' + String(x).replace('.', ','));
const PLATFORM = { ios: 'iOS', android: 'Android', web: 'Web' };
const YERLER = { bolumArasi: 'Bölüm arası', can: 'Can', guclendirici: 'Güçlendirici', ikiKat: 'İki kat ödül', devam: 'Devam (yer aç)', magaza: 'Mağaza altını', magazaBedava: 'Mağaza bedava', diger: 'Diğer' };
const yerAd = (y) => esc(YERLER[y] || y);
function roOzetKutu() {
  const v = K.ro.veri, d = v && v.dizi ? v.dizi.find((x) => x.gun === v.bugun) : null;
  koy('rkOzetKutu', '<span class="et">Bugün reklam</span><b>' + (d ? fmt(d.gecis) + ' geçiş · ' + fmt(d.odullu) + ' ödüllü' : K.ro.hata ? 'alınamadı' : '…') + '</b><span class="ok" aria-hidden="true">›</span>');
}
function roTahminCiz() {
  const v = K.ro.veri, e = ecpmOku(), g = ecpmSayi(e.gecis), o = ecpmSayi(e.odullu);
  if (document.activeElement !== $('ecpmGecis')) $('ecpmGecis').value = e.gecis || '';
  if (document.activeElement !== $('ecpmOdullu')) $('ecpmOdullu').value = e.odullu || '';
  if (!v) { koy('roTahmin', ''); return; }
  if (g === null && o === null) { koy('roTahmin', '<p class="note">Değer yazınca tahmin burada çıkar.</p>'); return; }
  const para = (x) => x.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const hesap = (gecis, odullu) => (g === null ? 0 : gecis * g / 1000) + (o === null ? 0 : odullu * o / 1000);
  const a = v.ozet, d = v.dizi.find((x) => x.gun === v.bugun) || { gecis: 0, odulluBasladi: 0 };
      const ara = v.aralik === 1 ? (v.gune === v.bugun ? 'Bugün' : kisa(v.gune)) : 'Son ' + v.aralik + ' gün';
  koy('roTahmin', '<div class="kpis tahmin-k">' + kutu('TAHMİN · ' + esc(ara), para(hesap(a.gecis, a.odulluBasladi)), '<span>' + fmt(a.gecis) + ' geçiş + ' + fmt(a.odulluBasladi) + ' ödüllü gösterim</span>', 'tahmin', true)
    + (v.aralik === 1 && v.gune === v.bugun ? '' : kutu('TAHMİN · bugün', para(hesap(d.gecis, d.odulluBasladi)), '', 'tahmin', true)) + '</div>'
    + '<p class="note">' + (ecpmOku() === ECPM_VARSAYILAN ? 'Başlangıç değerleri kullanılıyor: kaba tahmin. ' : '') + 'Para birimi: AdMob’da gördüğün birim (₺). Ödüllü gösterim = başlayan ödüllü reklam (izin veren oyuncular; gerçek gösterim daha fazla olabilir).</p>');
}
function roCiz() {
  document.querySelectorAll('[data-ro]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ro === roAralik)));
  roOzetKutu(); roTahminCiz();
  const s = K.ro, v = s.veri;
  if (!v) { yazi('roDurum', ''); koy('roGovde', '<p class="bos">' + bekliyor(s) + '</p>'); return; }
  const a = v.ozet, ara = v.aralik === 1 ? 'bugün' : 'son ' + v.aralik + ' gün';
  yazi('roDurum', '· ' + ara);
  const mx = Math.max(1, ...v.dizi.map((x) => x.gecis + x.odullu));
  const cubuk = '<div class="rbars" role="img" aria-label="Son 30 gün: gün başına geçiş ve tamamlanan ödüllü reklam">' + v.dizi.map((x) => '<span class="rbar' + (x.gun === v.bugun ? ' bugun' : '') + '" title="' + esc(kisa(x.gun)) + ': ' + x.gecis + ' geçiş, ' + x.odullu + ' ödüllü, ' + x.oyuncu + ' oyuncu"><span class="rgovde" style="height:' + (100 * (x.gecis + x.odullu) / mx).toFixed(1) + '%"><b style="height:' + (x.gecis + x.odullu ? (100 * x.odullu / (x.gecis + x.odullu)).toFixed(1) : 0) + '%"></b></span></span>').join('') + '</div>'
    + '<div class="raxis"><span>' + esc(kisa(v.dizi[0].gun)) + '</span><span>' + esc(kisa(v.dizi[14].gun)) + '</span><span>Bugün</span></div>';
  const tablo = (bas, satirlar, hucre, bos) => '<div class="scroll"><table class="rk"><thead><tr>' + bas.map((x, i) => '<th' + (i ? '' : ' class="sol"') + '>' + x + '</th>').join('') + '</tr></thead><tbody>' + (satirlar.map(hucre).join('') || bosTr(bas.length, bos)) + '</tbody></table></div>';
  const enCok = v.enCok.length ? '<ul class="liste">' + v.enCok.map((p, i) => satir(p, '<span>' + fmt(p.toplam) + '</span><small>reklam</small>', '<span>' + fmt(p.gecis) + ' geçiş · ' + fmt(p.odullu) + ' ödüllü</span>', '', i + 1)).join('') + '</ul>' : '<p class="bos">Bu aralıkta reklam gören yok.</p>';
  koy('roGovde', '<div class="kpis bes">' + kutu('Geçiş gösterildi', fmt(a.gecis), '<span>dolmadı ' + fmt(a.gecisYok) + '</span>', 'ana')
    + kutu('Ödüllü tamamlandı', fmt(a.odulluTamam), '<span>başladı ' + fmt(a.odulluBasladi) + ' · yarım ' + fmt(a.odulluYarim) + '</span>', 'yesil')
    + kutu('Reklam gören oyuncu', fmt(a.gorenOyuncu)) + kutu('Kişi başı reklam', ondalik(a.kisiBasi), '<span>geçiş + ödüllü gösterim</span>')
    + kutu('Dolma oranı', yzd(a.gecisDolmaYuzde), '<span>geçiş · ödüllü ' + yzd(a.odulluDolmaYuzde) + '</span>') + '</div>'
    + '<p class="note">“Reklamsız oyna” teklifi: ' + fmt(a.teklifGoruldu) + ' gösterildi · ' + fmt(a.teklifKabul) + ' kabul · ' + fmt(a.teklifRet) + ' ret' + (a.teklifKabulYuzde === null ? '' : ' (' + yzd(a.teklifKabulYuzde) + ')') + '</p>'
    + '<h4>Son 30 gün <span class="lejant ic"><span><i class="l-eski"></i>Geçiş</span><span><i class="l-yeni"></i>Ödüllü (tamam)</span></span></h4>' + cubuk
    + '<h4>Platform ve kabuk derlemesi</h4>' + tablo(['Platform · derleme', 'Geçiş', 'Dolmadı', 'Ödüllü tamam', 'Oyuncu'], v.platformlar, (x) => '<tr><td class="sol">' + esc(PLATFORM[x.platform] || x.platform) + ' <span class="dur">· ' + (x.derleme ? 'derleme ' + esc(String(x.derleme)) : 'derleme bilinmiyor') + '</span></td><td>' + fmt(x.gecis) + '</td><td>' + fmt(x.gecisYok) + '</td><td>' + fmt(x.odulluTamam) + '</td><td>' + fmt(x.gorenOyuncu) + '</td></tr>', 'Bu aralıkta veri yok.')
    + '<h4>Ödüllü reklam yerleri</h4>' + tablo(['Yer', 'Başladı', 'Tamam', 'Yarım', 'Dolmadı'], v.yerler, (x) => '<tr><td class="sol">' + yerAd(x.yer) + '</td><td>' + fmt(x.basladi) + '</td><td>' + fmt(x.tamam) + '</td><td>' + fmt(x.yarim) + '</td><td>' + fmt(x.yok) + '</td></tr>', 'Bu aralıkta ödüllü reklam yok.')
    + '<h4>En çok reklam görenler <span class="dur">(en çok 30)</span></h4><p class="note">Bir satıra dokun, oyuncu kartı açılsın.</p>' + enCok);
}
function ecpmYaz() {
  const v = { gecis: $('ecpmGecis').value.trim().slice(0, 10), odullu: $('ecpmOdullu').value.trim().slice(0, 10) };
  for (const [a, id] of [['gecis', 'ecpmGecis'], ['odullu', 'ecpmOdullu']]) $(id).classList.toggle('hatali', !!v[a] && ecpmSayi(v[a]) === null);
  try { if (v.gecis || v.odullu) localStorage.setItem(ECPM, JSON.stringify(v)); else localStorage.removeItem(ECPM); } catch (e) { /* saklanamıyorsa yalnız bu açılışta */ }
  roTahminCiz();
}

function ciz() {
  const acik = anahtar !== null && K.gun.imza !== null, vy = oyun === 'vy';
  $('vapur').hidden = !vy; $('giris').hidden = vy || acik; $('pano').hidden = vy || !acik; $('durum').hidden = vy || !acik; $('sekmeler').hidden = vy || !acik;
  document.querySelectorAll('[data-sekme]').forEach((b) => { if (b.dataset.sekme === sekme) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  document.querySelectorAll('[data-sayfa]').forEach((e) => { e.hidden = e.dataset.sayfa !== sekme; });
  $('arac').hidden = sekme === 'adlar' || sekme === 'reklam';
  if (vy || !acik) { $('uyari').hidden = true; $('donus').hidden = true; return; }
  $('gun').min = kaydir(bugun, -GUN_GERI); $('gun').max = bugun; if ($('gun').value !== secili) $('gun').value = secili;
  $('geri').disabled = secili <= $('gun').min; $('ileri').disabled = secili >= bugun; $('bugunB').disabled = secili === bugun;
  ozetCiz();
  listeCiz('yeni', 'yeni', 'yeni', yeniGoster, ILK_YENI, 'Bugün ilk kez oynayanlar', 'İlk kez oynayanlar', secili === bugun ? 'Bugün henüz ilk kez oynayan yok.' : 'Bu gün ilk kez oynayan yok.', false);
  listeCiz('oyn', 'oynayan', 'oyn', oynGoster, ILK_OYN, 'Bugün oynayanlar', 'Oynayanlar', secili === bugun ? 'Bugün henüz oynayan yok.' : 'Bu gün oynayan yok.', true);
  grafikCiz(); ulkeCiz(); modCiz(); bolumCiz(); siraCiz(); gelenlerCiz(); reklamCiz(); roCiz(); adCiz();
  if (K.gun.veri) yazi('ilkNot', '“İlk geldiği gün”, sunucuda saklanan kayıtlardaki ilk gündür (kayıtlar ' + K.gun.veri.saklamaGun + ' gün saklanır).');
  // durum satırı ve uyarı
  const hatali = Object.values(K).filter((s) => s.hata && s.tanim()), g = K.gun;
  yazi('durumYazi', g.veri ? 'güncellendi ' + saatYaz(g.zaman) : g.hata ? 'alınamadı' : 'alınıyor…');
  $('nokta').className = 'dot' + (hatali.length ? ' kirmizi' : g.veri ? '' : ' bekle');
  $('uyari').hidden = !hatali.length;
  if (hatali.length) {
    const eski = hatali.filter((s) => s.veri).map((s) => s.zaman);
    yazi('uyariYazi', g.hata && !g.veri ? (grafik ? 'Bu günün bilgisi alınamadı.' : 'Bilgi alınamadı.')
      : eski.length ? 'Yeni bilgi alınamadı. Gösterilen: ' + saatYaz(Math.min(...eski)) + (eski.length < hatali.length ? ' (bazı bölümler alınamadı)' : '') : 'Bazı bölümler alınamadı.');
  }
  $('donus').hidden = secili === bugun || sekme === 'adlar' || sekme === 'reklam'; yazi('donusYazi', kisa(secili) + ' gösteriliyor');
}

/* ───────── oyuncu kartı ───────── */
let kartKontrol = null, kartK = null, kartAd = '';
function kartKapandi() { if (kartKontrol) kartKontrol.abort(); kartKontrol = null; kartK = null; const e = $('kart'); if (!e.open) e.textContent = ''; }
const kartBas = (ad, alt) => '<div class="kart-bas"><div class="kart-kim">' + avatar(ad) + '<div><h2 id="kartAd">' + (ad ? esc(ad) : '<i>Ad yazmamış oyuncu</i>') + '</h2>' + (alt ? '<p class="note">' + alt + '</p>' : '') + '</div></div><button type="button" class="kapat" aria-label="Kapat">✕</button></div>';
async function kartAc(k, ad) {
  if (kartKontrol) kartKontrol.abort();
  const kontrol = new AbortController(), n = nesil; kartKontrol = kontrol; kartK = k; kartAd = ad;
  const e = $('kart'); e.innerHTML = '<div class="ic">' + kartBas(ad) + '<p class="bos">Yükleniyor…</p></div>';
  if (!e.open) e.showModal(); e.scrollTop = 0;
  try {
    const j = await iste(sorgu('/api/pano-oyuncu', { k, bugun: yerelGun() }), kontrol);
    if (kontrol !== kartKontrol || n !== nesil) return;
    const p = j.oyuncu, b = yerelGun(), gunYaz = (g) => (g === b ? 'Bugün' : g === kaydir(b, -1) ? 'Dün' : kisa(g));
    const takildi = p.takildi ? 'Bölüm ' + p.takildi.bolum + ' (' + fmt(p.takildi.kez) + ' kez geçemedi)' : 'Şu an takılmadı';
    const oynadi = p.son14.filter((x) => x.oynadi).length;
    const gecmis = (p.adGecmisi || []).length ? '<h3>Ad geçmişi</h3><ul class="gecmis">' + p.adGecmisi.map((x) => '<li><span class="degisim"><span class="eski">' + esc(x.eski) + '</span><span class="okk">→</span><span class="yeniad">' + esc(x.yeni) + '</span></span><time>' + esc(gunYaz(x.gun)) + ' ' + esc(x.saat) + '</time></li>').join('') + '</ul>' : '';
    e.innerHTML = '<div class="ic">' + kartBas(p.ad, (p.kod ? '#' + esc(p.kod) + ' · ' : '') + (p.ilkGun === b ? '<span class="yeni">YENİ</span> ' : '') + 'sürüm ' + esc(p.surum))
      + '<div class="kpis">' + kutu('İlk geldiği gün', gunYaz(p.ilkGun), '', '', true) + kutu('Son görüldüğü gün', gunYaz(p.sonGun), '', '', true)
      + kutu('Kaç gün oynadı', fmt(p.gunSayisi) + ' gün') + kutu('Ulaştığı bölüm', p.ulastigiBolum === null ? '–' : bitti(p.ulastigiBolum) ? 'Hepsi' : fmt(p.ulastigiBolum))
      + kutu('Toplam deneme', fmt(p.toplamDeneme)) + kutu('Yıldız', '★ ' + fmt(p.yildiz))
      + kutu('Ülke', p.ulke ? ulkeYaz(p.ulke) : 'Bilinmiyor', p.ulke ? '<span>son görüldüğü ülke</span>' : '<span>ülke ' + ULKE_BAS + '\'den beri tutuluyor; yeniden oynayınca gelir</span>', 'tam ulke-k', true)      // PANO ÜLKE 1
      + kutu('Takıldığı bölüm', takildi, '', 'tam', true)
      + '</div>' + (p.reklam ? '<h3>Gördüğü reklamlar</h3><table class="rk kart-rk"><thead><tr><th class="sol"></th><th>Geçiş</th><th>Ödüllü</th></tr></thead><tbody>' + [['Bugün', p.reklam.bugun], ['Son 7 gün', p.reklam.son7], ['Toplam', p.reklam.toplam]].map((x) => '<tr><td class="sol">' + x[0] + '</td><td>' + fmt(x[1].gecis) + '</td><td>' + fmt(x[1].odullu) + '</td></tr>').join('') + '</tbody></table>' : '') + gecmis + '<h3>Son 14 günde oynadığı günler</h3><div class="gunler" role="img" aria-label="Son 14 günün ' + oynadi + ' gününde oynadı">' + p.son14.map((x) => '<i class="' + (x.oynadi ? 'var' : '') + '"></i>').join('') + '</div><div class="gun-uc"><span>' + kisa(p.son14[0].gun) + '</span><span>' + gunYaz(p.son14[13].gun) + '</span></div></div>';
    e.querySelector('.kapat').focus();
  } catch (x) {
    if (kontrol !== kartKontrol || n !== nesil) return;
    const hata = x instanceof Hata ? x : new Hata(0, 'ag'), kapat = kapatanMesaj(hata);
    if (kapat) { cik(kapat, true); return; }
    const yok = hata.durum === 404 && hata.kod === 'yok';
    e.innerHTML = '<div class="ic">' + kartBas(ad) + '<p class="bos">' + (yok ? 'Bu oyuncunun oynama kaydı yok (veri paylaşmıyor ya da kaydı silinmiş).' : 'Alınamadı.') + '</p>' + (yok ? '' : '<button type="button" class="dugme tumu" data-is="kart-tekrar">Tekrar dene</button>') + '</div>';
  }
}

/* ───────── olaylar ───────── */
function gunSec(g) {
  gunDegisti();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(g || '')) g = bugun;
  const alt = kaydir(bugun, -GUN_GERI); secili = g > bugun ? bugun : g < alt ? alt : g;
  yeniGoster = ILK_YENI; oynGoster = ILK_OYN; siraGoster = ILK_SIRA;
  yukle('gun'); yukle('yeni'); yukle('oyn'); yukle('bGun'); yukle('sira');
  if (K.b30.imza !== K.b30.tanim().imza) yukle('b30');      // gece yarısı geçtiyse son 30 günün tablosu da yeni güne döner
}
function oyunSec(k) {
  oyun = k;
  document.querySelectorAll('[data-oyun]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.oyun === k)));
  const oyunAd = k === 'vy' ? 'Knock Shot' : 'Vapura Yetiş'; yazi('baslik', oyunAd); document.title = oyunAd + ' · Canlı Pano';
  if ($('kart').open) $('kart').close();
  ciz(); if (k === 'ks' && donusBekliyor) tazele();
}
$('girisForm').addEventListener('submit', (e) => { e.preventDefault(); baglan($('anahtar').value, $('hatirla').checked); });
$('unut').addEventListener('click', () => { cik('Anahtar bu cihazdan silindi.', true); window.scrollTo(0, 0); });
$('tekrar').addEventListener('click', tazele);
$('yenile').addEventListener('click', () => { $('yenile').disabled = true; clearTimeout(dugmeBekle); dugmeBekle = setTimeout(() => { $('yenile').disabled = false; }, DUGME_MS); tazele(); });
$('gun').addEventListener('change', (e) => gunSec(e.target.value));
$('geri').addEventListener('click', () => gunSec(kaydir(secili, -1)));
$('ileri').addEventListener('click', () => gunSec(kaydir(secili, 1)));
$('bugunB').addEventListener('click', () => { gunDegisti(); gunSec(bugun); });
$('donusB').addEventListener('click', () => { gunDegisti(); gunSec(bugun); });
$('bars').addEventListener('click', (e) => { const b = e.target.closest('.bar'); if (b) gunSec(b.dataset.g); });
$('yalnizGun').addEventListener('change', () => yukle('bGun'));
$('ecpmGecis').addEventListener('input', ecpmYaz); $('ecpmOdullu').addEventListener('input', ecpmYaz);
$('ara').addEventListener('input', () => { clearTimeout(araBekle); oynGoster = $('ara').value.trim() ? BOYUT : ILK_OYN; araBekle = setTimeout(() => yukle('oyn'), 400); ciz(); });
$('sAra').addEventListener('input', () => { clearTimeout(siraBekle); siraGoster = $('sAra').value.trim() ? BOYUT : ILK_SIRA; siraBekle = setTimeout(() => yukle('sira'), 400); });
$('yalnizYeni').addEventListener('change', () => { siraGoster = $('yalnizYeni').checked ? BOYUT : ILK_SIRA; yukle('sira'); });
document.querySelector('.oyun').addEventListener('click', (e) => { const b = e.target.closest('[data-oyun]'); if (b && b.dataset.oyun !== oyun) oyunSec(b.dataset.oyun); });
$('glOneri').addEventListener('change', () => { glGoster = BOYUT; yukle('glL'); });
function sekmeSec(ad, adresYaz) {
  if (!SEKMELER.includes(ad)) ad = 'genel';
  if (ad === sekme) return; sekme = ad;
  if (adresYaz) { try { history.replaceState(null, '', '#' + ad); } catch (e) { /* adres yazılamasa da sekme açılır */ } }
  ciz(); window.scrollTo(0, 0);
}
$('sekmeler').addEventListener('click', (e) => { const b = e.target.closest('[data-sekme]'); if (b) sekmeSec(b.dataset.sekme, true); });
window.addEventListener('hashchange', () => sekmeSec(location.hash.slice(1), false));
$('pano').addEventListener('click', (e) => {
  const sr = e.target.closest('[data-sira]'); if (sr) { const [a, alan] = sr.dataset.sira.split(':'); siraSec(a, alan); return; }
  const git = e.target.closest('[data-git]'); if (git) { sekmeSec(git.dataset.git, true); return; }
  const adb = e.target.closest('[data-is^="ad-"]'); if (adb) { adGoster = adb.dataset.is === 'ad-kisalt' ? BOYUT : adGoster + BOYUT; if (adGoster <= K.ad.veri.liste.length) ciz(); else yukle('ad'); return; }
  const gl = e.target.closest('[data-gl]'); if (gl) { if (gl.dataset.gl !== glAralik) { glAralik = gl.dataset.gl; glGun = null; glGoster = BOYUT; yukle('gl'); } return; }
  const glg = e.target.closest('[data-glg]'); if (glg) { glGun = glg.dataset.glg; glGoster = BOYUT; yukle('glL'); return; }
  const ro = e.target.closest('[data-ro]'); if (ro) { if (ro.dataset.ro !== roAralik) { roAralik = ro.dataset.ro; yukle('ro'); } return; }
  const rk = e.target.closest('[data-rk]'); if (rk) { if (rk.dataset.rk !== rkAralik) { rkAralik = rk.dataset.rk; yukle('rk'); } return; }
  const glb = e.target.closest('[data-is^="gl-"]'); if (glb) { glGoster = glb.dataset.is === 'gl-kisalt' ? BOYUT : glGoster + BOYUT; yukle('glL'); return; }
  const kisi = e.target.closest('[data-k]'); if (kisi) { kartAc(kisi.dataset.k, kisi.dataset.ad); return; }
  const b = e.target.closest('[data-is]'); if (!b) return;
  const [ad, is] = b.dataset.is.split('-');
  if (ad === 'sira') {
    if (is === 'kisalt') siraGoster = ILK_SIRA;
    else { const eldeki = K.sira.veri.liste.length, gorunen = Math.min(siraGoster, eldeki); siraGoster = gorunen < eldeki ? Math.min(eldeki, BOYUT * Math.ceil((gorunen + 1) / BOYUT)) : BOYUT * (Math.floor(gorunen / BOYUT) + 1); if (siraGoster <= eldeki) { ciz(); return; } }
    yukle('sira'); return;
  }
  const ilk = ad === 'yeni' ? ILK_YENI : ILK_OYN, simdi = ad === 'yeni' ? yeniGoster : oynGoster;
  const sonra = is === 'kisalt' ? ($('ara').value.trim() && ad === 'oyn' ? BOYUT : ilk) : simdi < BOYUT ? BOYUT : simdi + BOYUT;
  if (ad === 'yeni') yeniGoster = sonra; else oynGoster = sonra;
  yukle(ad);
});
$('kart').addEventListener('click', (e) => { if (e.target === $('kart') || e.target.closest('.kapat')) $('kart').close(); else if (e.target.closest('[data-is="kart-tekrar"]')) kartAc(kartK, kartAd); });
$('kart').addEventListener('close', kartKapandi);
document.addEventListener('visibilitychange', geriDonus);
// yalnız "şu an oyunda" dakikada bir yenilenir (tek küçük sorgu); öbür sayılar kendiliğinden yenilenmez
setInterval(() => { if (document.visibilityState === 'visible' && anahtar !== null && oyun === 'ks' && K.gun.imza !== null && !K.canli.surer) yukle('canli'); }, 30000);
window.addEventListener('pageshow', geriDonus);
// başka sekmede "unut" denirse bu sekme de kapanır
window.addEventListener('storage', (e) => { if (e.key === DEPO && e.newValue === null && anahtar !== null && hatirla) cik('Anahtar bu cihazdan silindi.', false); });

if (SEKMELER.includes(location.hash.slice(1))) sekme = location.hash.slice(1);
// açılış: saklanan anahtar varsa doğrudan bağlan (sunucuya ulaşılamazsa anahtar silinmez; bölümler "alınamadı" der)
const saklanan = depoOku();
if (saklanan) {
  anahtar = saklanan; hatirla = true; sonTur = Date.now();
  $('pano').hidden = false;
  yukle('gun'); yukle('b30'); yukle('sira'); yukle('gl'); yukle('rk'); yukle('ro'); yukle('ad'); yukle('canli'); yukle('ul');
} else ciz();
}
