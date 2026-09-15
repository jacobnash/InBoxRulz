import Anthropic from "@anthropic-ai/sdk";
import type {
  NormalizedMessage,
  RescueClassification,
  RescueClassifier,
  RescueConfig,
} from "@inboxrulz/rules-engine";

/**
 * No-API-key fallback. Deliberately conservative: it only catches the
 * clearest signal (a reply/forward subject) and otherwise says "not
 * important" rather than guess — a false negative here just means a
 * message that should be more thoroughly reviewed stays out of the inbox
 * for one more day, whereas a false positive defeats the point of every
 * other rule. Configure `createAnthropicRescueClassifier` for real
 * judgment; this exists so the pipeline runs end-to-end without an API key.
 */
export const heuristicRescueClassifier: RescueClassifier = (message) => {
  if (/^\s*(re|fwd?)\s*:/i.test(message.subject)) {
    return { important: true, reason: "Subject reads like a reply or forward" };
  }
  return {
    important: false,
    reason: "No correspondence signal found (heuristic fallback — configure an LLM classifier for real judgment)",
  };
};

export interface AnthropicClassifierOptions {
  apiKey?: string;
  model?: string;
}

/**
 * The judgment-based classifier from spec section 4/9: called only for the
 * narrow set of candidates planRescue couldn't already resolve via trusted
 * senders/keywords, and only ever given message metadata (from/subject/
 * snippet) — never credentials or full message bodies.
 */
export function createAnthropicRescueClassifier(
  options: AnthropicClassifierOptions = {},
): RescueClassifier {
  const client = new Anthropic({ apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY });
  const model = options.model ?? "claude-sonnet-5";

  return async (message, config) => {
    const response = await client.messages.create({
      model,
      max_tokens: 200,
      messages: [{ role: "user", content: buildPrompt(message, config) }],
    });
    return parseResponse(response);
  };
}

function buildPrompt(message: NormalizedMessage, config: RescueConfig): string {
  const lines = [
    "An inbox-hygiene system already moved this email thread out of the inbox.",
    "Decide whether it should be restored because it looks personally or",
    "professionally important (correspondence from a real person, something",
    "job/business-related, a reply to something the user likely sent) as",
    "opposed to bulk or automated mail (newsletters, marketing, notifications,",
    "receipts already handled elsewhere).",
    "",
    `From: ${message.from}`,
    `Subject: ${message.subject}`,
    `Snippet: ${message.snippet}`,
  ];
  if (config.keywords.length > 0) {
    lines.push(`User-flagged important keywords: ${config.keywords.join(", ")}`);
  }
  lines.push(
    "",
    'Respond with exactly one JSON object and nothing else: {"important": boolean, "reason": string}.',
  );
  return lines.join("\n");
}

function parseResponse(response: Anthropic.Message): RescueClassification {
  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );
  try {
    const parsed = JSON.parse(textBlock?.text ?? "");
    if (typeof parsed.important === "boolean" && typeof parsed.reason === "string") {
      return parsed;
    }
  } catch {
    // fall through to the safe default below
  }
  return {
    important: false,
    reason: "Classifier returned an unparseable response; defaulting to not important",
  };
}
