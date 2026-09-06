/**
 * Daily Drill - the catalog's identity (SPEC.md §6).
 *
 * `catalog_version` was a date typed into app.js by hand. Nothing compared it
 * against anything, because the catalog file is a bare array and carries no
 * version of its own - so the constant could drift away from the file it was
 * supposed to describe, and did. Concepts were added; the date stayed at
 * 2026-09-03.
 *
 * Deriving it from the catalog removes the step a person has to remember. The
 * fingerprint changes exactly when a concept is added, removed or renamed,
 * which is the thing SPEC's risk table wants to detect ("catalog rot or
 * renames"). It deliberately does NOT move when concepts.json is reformatted,
 * reordered, or has a tier or prerequisite edited: none of those invalidate a
 * stored attempt, and a version that changes for harmless reasons trains you
 * to ignore it.
 */

/**
 * A short, stable identity for a set of concepts, e.g. `181c-9f2a41b0`.
 *
 * The leading count is there to be read by a human in the settings line; the
 * hash is there to be compared. FNV-1a rather than SubtleCrypto because this
 * needs to be synchronous inside boot() and has no security role - it only has
 * to change when its input does.
 *
 * @param {{id: string}[]} catalog concept rows as loaded from concepts.json
 * @returns {string}
 */
export function catalogFingerprint(catalog) {
  const rows = Array.isArray(catalog) ? catalog : [];
  const ids = rows
    .map(c => (c && typeof c.id === 'string' ? c.id : ''))
    .filter(Boolean)
    .sort()
    .join('\n');

  let h = 0x811c9dc5;
  for (let i = 0; i < ids.length; i++) {
    h ^= ids.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${rows.length}c-${h.toString(16).padStart(8, '0')}`;
}
