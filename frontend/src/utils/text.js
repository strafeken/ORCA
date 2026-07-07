/** Returns "" or "s" for simple English pluralisation. */
export function pluralSuffix(count) {
  return count === 1 ? "" : "s";
}
