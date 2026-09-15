/**
 * Matches a `from` address against a list of exact addresses or bare
 * domains ("acme.com" matches anyone@acme.com, including subdomains like
 * anyone@mail.acme.com). Case-insensitive throughout.
 */
export function matchesSenderList(from: string, list: readonly string[]): boolean {
  const email = extractEmail(from).toLowerCase();
  const domain = email.split("@")[1] ?? "";
  return list.some((entry) => {
    const needle = entry.toLowerCase().trim();
    if (!needle) return false;
    if (needle.includes("@")) return needle === email;
    return domain === needle || domain.endsWith(`.${needle}`);
  });
}

/** Pulls the bare address out of a "Display Name <addr@example.com>" header. */
function extractEmail(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return (match ? match[1] : from).trim();
}
