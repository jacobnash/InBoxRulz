import { describe, expect, it } from "vitest";
import { buildGmailSearchQuery } from "../src/gmail/query.js";

describe("buildGmailSearchQuery", () => {
  it("always excludes spam and trash", () => {
    expect(buildGmailSearchQuery({})).toBe("-in:spam -in:trash");
  });

  it("scopes to inbox", () => {
    expect(buildGmailSearchQuery({ location: "inbox" })).toBe("-in:spam -in:trash in:inbox");
  });

  it("scopes to archived (not in inbox)", () => {
    expect(buildGmailSearchQuery({ location: "archived" })).toBe("-in:spam -in:trash -in:inbox");
  });

  it("adds a category filter", () => {
    expect(buildGmailSearchQuery({ category: "promotions" })).toBe(
      "-in:spam -in:trash category:promotions",
    );
  });

  it("adds recency bounds", () => {
    expect(
      buildGmailSearchQuery({ receivedWithinDays: 2, receivedOlderThanDays: 30 }),
    ).toBe("-in:spam -in:trash newer_than:2d older_than:30d");
  });

  it("requires and excludes tags", () => {
    expect(
      buildGmailSearchQuery({
        withTags: ["InboxRules/PromoArchived"],
        withoutTags: ["InboxRules/Receipts"],
      }),
    ).toBe(
      '-in:spam -in:trash label:"InboxRules/PromoArchived" -label:"InboxRules/Receipts"',
    );
  });
});
