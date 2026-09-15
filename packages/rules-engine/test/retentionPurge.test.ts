import { describe, expect, it } from "vitest";
import { planRetentionPurge } from "../src/rules/retentionPurge.js";
import { parseRuleConfig } from "../src/config.js";
import { TAGS } from "../src/tags.js";
import { makeMessage, daysAgo } from "./helpers.js";

const now = new Date("2026-02-01T00:00:00Z");
const config = parseRuleConfig("retention_purge", { retentionDays: 30 });

describe("planRetentionPurge", () => {
  it("trashes archived, tagged mail older than the retention window", () => {
    const msg = makeMessage({
      inInbox: false,
      tags: [TAGS.PROMO_ARCHIVED],
      receivedAt: daysAgo(now, 31),
    });
    expect(planRetentionPurge([msg], config, now)).toEqual([
      expect.objectContaining({ action: "trash", threadId: msg.threadId }),
    ]);
  });

  it("leaves mail inside the retention window alone", () => {
    const msg = makeMessage({ inInbox: false, tags: [TAGS.PROMO_ARCHIVED], receivedAt: daysAgo(now, 10) });
    expect(planRetentionPurge([msg], config, now)).toEqual([]);
  });

  it("is exactly inclusive at the threshold boundary", () => {
    const msg = makeMessage({ inInbox: false, tags: [TAGS.PROMO_ARCHIVED], receivedAt: daysAgo(now, 30) });
    expect(planRetentionPurge([msg], config, now)).toEqual([
      expect.objectContaining({ action: "trash" }),
    ]);
  });

  it("never purges mail still in the inbox", () => {
    const msg = makeMessage({ inInbox: true, tags: [TAGS.PROMO_ARCHIVED], receivedAt: daysAgo(now, 60) });
    expect(planRetentionPurge([msg], config, now)).toEqual([]);
  });

  it("never purges Receipts even if old and otherwise eligible", () => {
    const msg = makeMessage({
      inInbox: false,
      tags: [TAGS.PROMO_ARCHIVED, TAGS.RECEIPTS],
      receivedAt: daysAgo(now, 365),
    });
    expect(planRetentionPurge([msg], config, now)).toEqual([]);
  });

  it("ignores archived mail with no eligible tag", () => {
    const msg = makeMessage({ inInbox: false, tags: [], receivedAt: daysAgo(now, 365) });
    expect(planRetentionPurge([msg], config, now)).toEqual([]);
  });
});
