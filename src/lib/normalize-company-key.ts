/**
 * Normalizes a company name to a deduplicated key by:
 * 1. Lowercasing and trimming
 * 2. Stripping common legal suffixes (Limited, Pvt Ltd, Corp, Inc, etc.)
 * 3. Collapsing extra whitespace
 *
 * Examples:
 *   "Infosys Private Limited" → "infosys"
 *   "Infosys Pvt. Ltd."       → "infosys"
 *   "Infosys Limited"         → "infosys"
 *   "Microsoft Corporation"   → "microsoft"
 *   "Apple Inc."              → "apple"
 */
export function normalizeCompanyKey(name: string): string {
  return name
    .toLowerCase()
    .trim()
    // Strip common legal suffixes from the end (longest first to avoid partial matches).
    // "co" and "inc" require a leading space/comma/period to avoid stripping
    // from the middle of real names like "Sysco" or "Zinc".
    .replace(
      /[\s,.]*(private limited|pvt\.?\s*ltd\.?|p\.?\s*ltd\.?|limited liability partnership|limited liability company|incorporated|corporation|limited|llp|llc|corp\.?|plc|gmbh|ag|b\.?v\.?|pte\.?\s*ltd\.?|s\.?a\.?|n\.?v\.?|[\s,.]inc\.?|[\s,.]and\s+co\.?|[\s,.]&\s*co\.?|[\s,.]co\.?|[\s,.]pvt\.?)\s*$/gi,
      ""
    )
    .trim()
    .replace(/\s+/g, " ");
}
