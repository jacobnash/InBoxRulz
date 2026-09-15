import { describe, expect, it, vi } from "vitest";
import { planRescue, type RescueClassifier } from "../src/rules/rescue.js";
import { parseRuleConfig } from "../src/config.js";
import { TAGS } from "../src/tags.js";
import { makeMessage, daysAgo } from "./helpers.js";

const now = new Date("2026-02-01T00:00:00Z");

function alwaysImportant(): ReturnType<RescueClassifier> {
  return { important: true, reason: "classifier says important" };
}
function neverImportant(): ReturnType<RescueClassifier> {
  return { important: false, reason: "classifier says not important" };
}

describe("planRescue", () => {
  it("restores and tags a thread the classifier deems important", async () => {
    const config = parseRuleConfig("rescue", {});
    const msg = makeMessage({ inInbox: false, receivedAt: daysAgo(now, 1) });
    const actions = await planRescue([msg], config, alwaysImportant, now);
    expect(actions).toEqual([
      expect.objectContaining({ action: "restore_to_inbox", threadId: msg.threadId }),
      expect.objectContaining({ action: "label", label: TAGS.RESCUED }),
    ]);
  });

  it("takes no action when the classifier says not important", async () => {
    const config = parseRuleConfig("rescue", {});
    const msg = makeMessage({ inInbox: false, receivedAt: daysAgo(now, 1) });
    expect(await planRescue([msg], config, neverImportant, now)).toEqual([]);
  });

  it("never re-evaluates a thread already tagged RESCUED (idempotency)", async () => {
    const config = parseRuleConfig("rescue", {});
    const msg = makeMessage({ inInbox: false, receivedAt: daysAgo(now, 1), tags: [TAGS.RESCUED] });
    const classifier = vi.fn(alwaysImportant);
    expect(await planRescue([msg], config, classifier, now)).toEqual([]);
    expect(classifier).not.toHaveBeenCalled();
  });

  it("ignores mail still in the inbox", async () => {
    const config = parseRuleConfig("rescue", {});
    const msg = makeMessage({ inInbox: true, receivedAt: daysAgo(now, 1) });
    const classifier = vi.fn(alwaysImportant);
    expect(await planRescue([msg], config, classifier, now)).toEqual([]);
    expect(classifier).not.toHaveBeenCalled();
  });

  it("ignores mail older than the lookback window", async () => {
    const config = parseRuleConfig("rescue", { lookbackDays: 2 });
    const msg = makeMessage({ inInbox: false, receivedAt: daysAgo(now, 3) });
    const classifier = vi.fn(alwaysImportant);
    expect(await planRescue([msg], config, classifier, now)).toEqual([]);
    expect(classifier).not.toHaveBeenCalled();
  });

  it("short-circuits to important for a trusted sender without calling the classifier", async () => {
    const config = parseRuleConfig("rescue", { trustedSenders: ["acme.com"] });
    const msg = makeMessage({
      inInbox: false,
      receivedAt: daysAgo(now, 1),
      from: "Boss <boss@acme.com>",
    });
    const classifier = vi.fn(alwaysImportant);
    const actions = await planRescue([msg], config, classifier, now);
    expect(actions).toEqual([
      expect.objectContaining({ action: "restore_to_inbox" }),
      expect.objectContaining({ action: "label", label: TAGS.RESCUED }),
    ]);
    expect(classifier).not.toHaveBeenCalled();
  });

  it("short-circuits to important on a keyword match without calling the classifier", async () => {
    const config = parseRuleConfig("rescue", { keywords: ["job offer"] });
    const msg = makeMessage({ inInbox: false, receivedAt: daysAgo(now, 1), subject: "Your job offer" });
    const classifier = vi.fn(alwaysImportant);
    await planRescue([msg], config, classifier, now);
    expect(classifier).not.toHaveBeenCalled();
  });

  it("skips an ignored sender entirely, without calling the classifier", async () => {
    const config = parseRuleConfig("rescue", { ignoredSenders: ["spammer.com"] });
    const msg = makeMessage({
      inInbox: false,
      receivedAt: daysAgo(now, 1),
      from: "Bulk <bulk@spammer.com>",
    });
    const classifier = vi.fn(alwaysImportant);
    expect(await planRescue([msg], config, classifier, now)).toEqual([]);
    expect(classifier).not.toHaveBeenCalled();
  });
});
