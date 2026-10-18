// Normalisierung von Straßennamen & Suchtexten.

/** Vereinheitlicht Schreibweisen: "Goethestr." → "Goethestraße", Mehrfach-Leerzeichen, Unicode NFC. */
export function normalizeStreetName(raw: string): string {
  let s = String(raw ?? '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return s;
  // Abkürzungen am Wortende: "str." / "Str." → "straße"/"Straße"
  s = s.replace(/([a-zäöüß])str\.?$/i, (_m, c: string) => `${c}straße`);
  s = s.replace(/\bStr\.?$/u, 'Straße');
  s = s.replace(/strasse$/i, 'straße').replace(/Strasse$/u, 'Straße');
  s = s.replace(/\bPl\.$/u, 'Platz');
  // erster Buchstabe groß (Straßennamen beginnen in DE i. d. R. groß)
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return s;
}

/** Schlüssel für Dublettenerkennung & Suche (klein, ohne Akzente/Satzzeichen, ß→ss, straße→str). */
export function streetKey(raw: string): string {
  return normalizeStreetName(raw)
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/strasse\b/g, 'str')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

export function searchKey(raw: string): string {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** Für Suche nach "goe" → Goethestraße, "hauptstr" → Hauptstraße */
export function matchesSearch(haystack: string, needle: string): boolean {
  const n = searchKey(needle).trim();
  if (!n) return true;
  const h = searchKey(haystack);
  return n.split(/\s+/).every((part) => h.includes(part) || h.replace(/strasse/g, 'str').includes(part));
}

export function isPostalCode(s: string): boolean {
  return /^\d{5}$/.test(s.trim());
}
