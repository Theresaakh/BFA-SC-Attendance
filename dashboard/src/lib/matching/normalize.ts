/** Lower-case, strip accents and punctuation, collapse whitespace. Keeps Arabic and other scripts. */
export function normalizeName(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Words that are commonly added to customer names in accounting but are not part of the player's name. */
const NOISE_TOKENS = new Set(["mr", "mrs", "ms", "miss", "dr", "parent", "father", "mother", "dad", "mom", "mum", "of", "for", "player"]);

export function nameTokens(name: string | null | undefined): string[] {
  return normalizeName(name)
    .split(" ")
    .filter((t) => t.length > 0 && !NOISE_TOKENS.has(t));
}

export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const e = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

/**
 * Canonical form for Lebanese (and other) phone numbers: digits only, with the country
 * code and trunk prefix removed, so "+961 3 123 456", "00961-3-123456" and "03/123456" all match.
 */
export function normalizePhone(phone: string | null | undefined, countryCode = "961"): string | null {
  if (!phone) return null;
  let d = phone.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith(countryCode) && d.length > countryCode.length + 6) d = d.slice(countryCode.length);
  d = d.replace(/^0+/, "");
  return d.length >= 6 ? d : null;
}

/** Extract an age category such as "U14" from a team name ("U14 Boys", "Under-14", "U 14 A"). */
export function categoryFromTeamName(name: string | null | undefined): string | null {
  if (!name) return null;
  const m = /\b(?:u|under)\s*-?\s*(\d{1,2})\b/i.exec(name);
  return m ? `U${Number(m[1])}` : null;
}

// ---------------------------------------------------------------------------
// Similarity
// ---------------------------------------------------------------------------

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return a.length ? 1 : 0;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatch = new Array<boolean>(a.length).fill(false);
  const bMatch = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - range);
    const hi = Math.min(i + range + 1, b.length);
    for (let j = lo; j < hi; j++) {
      if (bMatch[j] || a[i] !== b[j]) continue;
      aMatch[i] = bMatch[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let t = 0;
  for (let i = 0, k = 0; i < a.length; i++) {
    if (!aMatch[i]) continue;
    while (!bMatch[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Order-independent name similarity in [0, 1]. Each token of the shorter name is paired
 * with its best match in the longer name, so "Smith John" ≈ "John Smith" and
 * "John Smith" ≈ "John A. Smith". Extra tokens in the longer name cost a little.
 */
export function nameSimilarity(a: string, b: string): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return 0;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const used = new Set<number>();
  let total = 0;
  let weakest = 1;
  for (const s of short) {
    let best = 0;
    let bestIdx = -1;
    long.forEach((l, idx) => {
      if (used.has(idx)) return;
      const score = s.length === 1 || l.length === 1 ? (s[0] === l[0] ? 0.8 : 0) : jaroWinkler(s, l);
      if (score > best) {
        best = score;
        bestIdx = idx;
      }
    });
    if (bestIdx >= 0) used.add(bestIdx);
    total += best;
    weakest = Math.min(weakest, best);
  }
  const coverage = total / short.length;
  const extraPenalty = 0.04 * (long.length - short.length);
  // A single shared token (e.g. just a family name) is weak evidence.
  const singleTokenPenalty = short.length === 1 ? 0.2 : 0;
  // Every part of the name must match closely: "John Smith" is not "John Saad".
  const mismatchFactor = weakest < 0.85 ? 0.6 : 1;
  return Math.max(0, Math.min(1, (coverage - extraPenalty - singleTokenPenalty) * mismatchFactor));
}
