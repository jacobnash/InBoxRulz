import type { MailQuery } from "../types.js";

/** Translates a provider-agnostic MailQuery into a Gmail search string. */
export function buildGmailSearchQuery(query: MailQuery): string {
  const clauses: string[] = [];

  // Never touch Spam or Trash unless a rule explicitly asks to (no rule
  // does today — spec section 10 flags this as a deliberate open question).
  clauses.push("-in:spam", "-in:trash");

  if (query.location === "inbox") clauses.push("in:inbox");
  if (query.location === "archived") clauses.push("-in:inbox");

  if (query.category) clauses.push(`category:${query.category}`);
  if (query.receivedWithinDays !== undefined) {
    clauses.push(`newer_than:${query.receivedWithinDays}d`);
  }
  if (query.receivedOlderThanDays !== undefined) {
    clauses.push(`older_than:${query.receivedOlderThanDays}d`);
  }
  for (const tag of query.withTags ?? []) {
    clauses.push(`label:${quoteLabel(tag)}`);
  }
  for (const tag of query.withoutTags ?? []) {
    clauses.push(`-label:${quoteLabel(tag)}`);
  }

  return clauses.join(" ");
}

function quoteLabel(label: string): string {
  // Gmail label search matches on the label's own slug (spaces/slashes
  // become dashes); wrapping in quotes lets us pass the human-readable
  // name through unchanged and let Gmail's search do the normalizing.
  return `"${label}"`;
}
