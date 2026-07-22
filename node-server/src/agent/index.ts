import Anthropic from "@anthropic-ai/sdk";

export const SYSTEM_PROMPT =
  "You are a helpful shopping assistant. When a user describes what they want to buy, " +
  "ask clarifying questions if needed, then provide specific product suggestions with reasoning. " +
  "Include estimated price ranges, key features to look for, and trade-offs between options. " +
  "Be concise and practical.";

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1024;

// The SDK reads ANTHROPIC_API_KEY from the environment.
const client = new Anthropic();

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Streams the assistant turn token-by-token. No DB or API dependencies — the
 * WebSocket handler is the only consumer.
 */
export async function* streamResponse(messages: AgentMessage[]): AsyncGenerator<string> {
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages,
  });

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield event.delta.text;
    }
  }
}
