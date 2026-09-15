import { describe, expect, it } from "vitest";
import { planPromoArchive } from "../src/rules/promoArchive.js";
import { parseRuleConfig } from "../src/config.js";
import { TAGS } from "../src/tags.js";
import { makeMessage } from "./helpers.js";

const config = parseRuleConfig("promo_archive", {});

describe("planPromoArchive", () => {
  it("archives and tags inbox mail classified as promotions", () => {
    const msg = makeMessage({ category: "promotions", inInbox: true });
    const actions = planPromoArchive([msg], config);
    expect(actions).toEqual([
      expect.objectContaining({ action: "archive", threadId: msg.threadId }),
      expect.objectContaining({ action: "label", label: TAGS.PROMO_ARCHIVED }),
    ]);
  });

  it("ignores mail already archived", () => {
    const msg = makeMessage({ category: "promotions", inInbox: false });
    expect(planPromoArchive([msg], config)).toEqual([]);
  });

  it("ignores non-promotional inbox mail", () => {
    const msg = makeMessage({ category: "primary", inInbox: true });
    expect(planPromoArchive([msg], config)).toEqual([]);
  });

  it("does not re-tag a thread that already carries PROMO_ARCHIVED", () => {
    const msg = makeMessage({ category: "promotions", inInbox: true, tags: [TAGS.PROMO_ARCHIVED] });
    const actions = planPromoArchive([msg], config);
    expect(actions).toEqual([expect.objectContaining({ action: "archive" })]);
  });
});
