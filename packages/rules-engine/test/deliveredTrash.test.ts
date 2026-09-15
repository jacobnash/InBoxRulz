import { describe, expect, it } from "vitest";
import { planDeliveredTrash } from "../src/rules/deliveredTrash.js";
import { parseRuleConfig } from "../src/config.js";
import { TAGS } from "../src/tags.js";
import { makeMessage, daysAgo } from "./helpers.js";

const now = new Date("2026-02-01T00:00:00Z");
const config = parseRuleConfig("delivered_trash", {});

describe("planDeliveredTrash", () => {
  it("trashes a message that reads as delivered", () => {
    const msg = makeMessage({ subject: "Your package has been delivered", receivedAt: now });
    const actions = planDeliveredTrash([msg], config, now);
    expect(actions).toEqual([expect.objectContaining({ action: "trash", threadId: msg.threadId })]);
  });

  it("does not trash 'out for delivery' (not yet delivered)", () => {
    const msg = makeMessage({ subject: "Your order was delivered... just kidding, it's out for delivery" });
    expect(planDeliveredTrash([msg], config, now)).toEqual([]);
  });

  it("does not trash a delayed-delivery notice", () => {
    const msg = makeMessage({ subject: "Delayed: your package has been delivered to the wrong address" });
    expect(planDeliveredTrash([msg], config, now)).toEqual([]);
  });

  it("excludes threads already filed as Receipts", () => {
    const msg = makeMessage({ subject: "Your package has been delivered", tags: [TAGS.RECEIPTS] });
    expect(planDeliveredTrash([msg], config, now)).toEqual([]);
  });

  it("ignores mail with no delivery phrase", () => {
    const msg = makeMessage({ subject: "Weekly newsletter" });
    expect(planDeliveredTrash([msg], config, now)).toEqual([]);
  });

  it("holds a match inside the grace period", () => {
    const graced = parseRuleConfig("delivered_trash", { gracePeriodDays: 3 });
    const msg = makeMessage({ subject: "Your package has been delivered", receivedAt: daysAgo(now, 1) });
    expect(planDeliveredTrash([msg], graced, now)).toEqual([]);
  });

  it("releases a match once past the grace period", () => {
    const graced = parseRuleConfig("delivered_trash", { gracePeriodDays: 3 });
    const msg = makeMessage({ subject: "Your package has been delivered", receivedAt: daysAgo(now, 4) });
    expect(planDeliveredTrash([msg], graced, now)).toEqual([
      expect.objectContaining({ action: "trash" }),
    ]);
  });
});
