import { describe, expect, it } from "vitest";
import { planReceiptsFile } from "../src/rules/receiptsFile.js";
import { parseRuleConfig } from "../src/config.js";
import { TAGS } from "../src/tags.js";
import { makeMessage } from "./helpers.js";

const config = parseRuleConfig("receipts_file", {});

describe("planReceiptsFile", () => {
  it("tags and archives inbox mail classified as purchases", () => {
    const msg = makeMessage({ category: "purchases", inInbox: true });
    const actions = planReceiptsFile([msg], config);
    expect(actions).toEqual([
      expect.objectContaining({ action: "label", label: TAGS.RECEIPTS }),
      expect.objectContaining({ action: "archive" }),
    ]);
  });

  it("does not re-apply the Receipts label if already present", () => {
    const msg = makeMessage({ category: "purchases", inInbox: true, tags: [TAGS.RECEIPTS] });
    const actions = planReceiptsFile([msg], config);
    expect(actions).toEqual([expect.objectContaining({ action: "archive" })]);
  });

  it("ignores non-purchase mail", () => {
    const msg = makeMessage({ category: "primary", inInbox: true });
    expect(planReceiptsFile([msg], config)).toEqual([]);
  });
});
