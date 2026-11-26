// VAPURA PANO — ad anahtarları. Görünümlerde (sema.mjs) adn / ara = lower(nick); burada da aynı sadelikte tutulur.
export const adAnahtar = (ad) => String(ad).normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
export const araAnahtar = (ad) => adAnahtar(ad);
