// VAPURA PANO — tablolar ve uyum görünümleri (D1 / SQLite).
// Yazan uçlar: /api/oynama (oynama + reklam sayaçları + ülke), /api/lb (ad geçmişi + ülke).
// Pano (pano.mjs) Onur'un şemasını okur: skor / sira_kod / sira_ara / skor_bolum burada bizim "lb" tablomuzun GÖRÜNÜMLERİDİR.
export const SEMA = [
  // oynama kaydı (paket: bir istek = bir satır)
  "CREATE TABLE IF NOT EXISTS oynama (no INTEGER PRIMARY KEY, id TEXT NOT NULL, sira INTEGER NOT NULL, gun TEXT NOT NULL, bolum INTEGER NOT NULL, mod TEXT NOT NULL, sonuc TEXT NOT NULL, kalan INTEGER NOT NULL, yildiz INTEGER NOT NULL, top INTEGER, ek_top INTEGER, surum TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS oynama_gun_sira ON oynama (gun)",
  "CREATE TABLE IF NOT EXISTS oynama_oyuncu (id TEXT PRIMARY KEY, anahtar_karma TEXT NOT NULL, gun TEXT NOT NULL, say INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS oynama_oyuncu_gun ON oynama_oyuncu (gun)",
  "CREATE TABLE IF NOT EXISTS oynama_gun (gun TEXT PRIMARY KEY, say INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS oynama_paket (id TEXT NOT NULL, paket INTEGER NOT NULL, gun TEXT NOT NULL, adet INTEGER NOT NULL, veri TEXT NOT NULL, PRIMARY KEY (id, paket)) WITHOUT ROWID",
  "CREATE INDEX IF NOT EXISTS oynama_paket_gun ON oynama_paket (gun)",
  // ad geçmişi, ülke
  "CREATE TABLE IF NOT EXISTS ad_gecmis (id TEXT NOT NULL, zaman INTEGER NOT NULL, eski TEXT NOT NULL, yeni TEXT NOT NULL, PRIMARY KEY (id, zaman))",
  "CREATE INDEX IF NOT EXISTS ad_gecmis_zaman ON ad_gecmis (zaman)",
  "CREATE TABLE IF NOT EXISTS oyuncu_ulke (id TEXT PRIMARY KEY, ulke TEXT NOT NULL, ilk TEXT NOT NULL, gun TEXT NOT NULL) WITHOUT ROWID",
  "CREATE INDEX IF NOT EXISTS oyuncu_ulke_gun ON oyuncu_ulke (gun)",
  // oyundaki reklam sayaçları (ham olay yok). Onur'un notu: Apple Ads tablosuyla ad çakışmasın diye önekli.
  "CREATE TABLE IF NOT EXISTS reklam_sayac (gun TEXT NOT NULL, id TEXT NOT NULL, olay TEXT NOT NULL, yer TEXT NOT NULL, platform TEXT NOT NULL, derleme INTEGER NOT NULL, surum TEXT NOT NULL, bolum INTEGER NOT NULL, say INTEGER NOT NULL, PRIMARY KEY (gun, id, olay, yer, platform, derleme)) WITHOUT ROWID",
  "CREATE INDEX IF NOT EXISTS reklam_sayac_id ON reklam_sayac (id, gun)",
  "CREATE TABLE IF NOT EXISTS reklam_oyuncu (id TEXT PRIMARY KEY, paket INTEGER NOT NULL, gun TEXT NOT NULL, say INTEGER NOT NULL) WITHOUT ROWID",
  "CREATE TABLE IF NOT EXISTS oyun_reklam_gun (gun TEXT PRIMARY KEY, say INTEGER NOT NULL) WITHOUT ROWID",
  // uyum görünümleri: Kaptanlar Tablosu (lb) → Onur'un skor / sira_kod şeması
  "CREATE VIEW IF NOT EXISTS skor AS SELECT pid AS id, nick AS ad, NULL AS avatar, lvl AS bolum, stars AS yildiz, reached AS bz, 0 AS rs, -lvl AS nb, -stars AS ny FROM lb",
  "CREATE VIEW IF NOT EXISTS skor_bolum AS SELECT lvl AS bolum, COUNT(*) AS sayi FROM lb GROUP BY lvl",
  "CREATE VIEW IF NOT EXISTS sira_kod AS SELECT pid AS id, lower(nick) AS adn, 1000 + ((unicode(substr(pid,-1,1)) * 961 + unicode(substr(pid,-2,1)) * 31 + unicode(substr(pid,-3,1))) % 9000) AS kod, created AS zaman FROM lb",
  "CREATE VIEW IF NOT EXISTS sira_ara AS SELECT pid AS id, lower(nick) AS ara FROM lb",
];

let hazir = false;
export async function semaKur(db) {
  if (hazir || !db) return;
  await db.batch(SEMA.map((s) => db.prepare(s)));
  hazir = true;
}
