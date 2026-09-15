import type { gmail_v1 } from "googleapis";
import type { MessageCategory, NormalizedMessage } from "@inboxrulz/rules-engine";

const CATEGORY_LABELS: Record<string, MessageCategory> = {
  CATEGORY_PROMOTIONS: "promotions",
  CATEGORY_SOCIAL: "social",
  CATEGORY_UPDATES: "updates",
  CATEGORY_FORUMS: "forums",
  CATEGORY_PERSONAL: "primary",
};

function categoryFromLabelIds(labelIds: string[]): MessageCategory | undefined {
  for (const [labelId, category] of Object.entries(CATEGORY_LABELS)) {
    if (labelIds.includes(labelId)) return category;
  }
  return undefined;
}

function headerValue(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string,
): string {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

/**
 * Maps a Gmail thread (fetched with format=metadata) to the
 * provider-agnostic NormalizedMessage shape.
 *
 * `labelIdToTag` should contain only the account's custom (user-created)
 * labels, id -> name — that's what InboxRules' own permanent tags
 * (Receipts, PromoArchived, Rescued) show up as, alongside any labels the
 * user made themselves. System labels like INBOX/UNREAD are handled via
 * `inInbox` instead of being surfaced as tags.
 *
 * `queryCategory`, when the listing query already filtered on a category,
 * is a fallback for categories Gmail doesn't expose as a persistent label
 * on the message (`category:purchases` is a search-time classification,
 * not a labelId the way CATEGORY_PROMOTIONS is) — the search already
 * guaranteed the match, so we trust it directly rather than re-deriving it.
 */
export function normalizeGmailThread(
  thread: gmail_v1.Schema$Thread,
  labelIdToTag: ReadonlyMap<string, string>,
  queryCategory?: MessageCategory,
): NormalizedMessage | null {
  const messages = thread.messages ?? [];
  const latest = messages[messages.length - 1];
  if (!latest || !thread.id) return null;

  const labelIds = latest.labelIds ?? [];
  const tags = labelIds
    .map((id) => labelIdToTag.get(id))
    .filter((t): t is string => Boolean(t));

  return {
    threadId: thread.id,
    from: headerValue(latest.payload?.headers, "From"),
    subject: headerValue(latest.payload?.headers, "Subject"),
    snippet: thread.snippet ?? latest.snippet ?? "",
    receivedAt: new Date(Number(latest.internalDate ?? Date.now())),
    inInbox: labelIds.includes("INBOX"),
    category: categoryFromLabelIds(labelIds) ?? queryCategory,
    tags,
  };
}
