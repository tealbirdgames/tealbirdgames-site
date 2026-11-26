// VAPURA PANO — Apple Ads henüz bağlı değil (Onur'un panosundaki kart "Bağlı değil" gösterir).
export const REKLAM_PANO_YOLU = "/api/pano-reklam";
export async function reklamOku(db, s, ayar) { return { durum: 200, govde: { ok: true, bagli: false, eksik: (ayar.reklam && ayar.reklam.eksik) || ["APPLE_ADS_CLIENT_ID", "APPLE_ADS_TEAM_ID", "APPLE_ADS_KEY_ID", "APPLE_ADS_PRIVATE_KEY"] } }; }
