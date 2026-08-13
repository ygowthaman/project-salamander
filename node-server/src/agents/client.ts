import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { transformJSONSchema } from "@anthropic-ai/sdk/lib/transform-json-schema";

export const client = new Anthropic();

export const defaultModel = "claude-sonnet-5";

export type Turn = { role: "user" | "assistant"; content: string };

export async function interpretAs<T extends z.ZodType>(
  sentence: string,
  system: string,
  schema: T,
  history: Turn[] = [],
  model: string = defaultModel
): Promise<z.infer<T> | null> {
  const response = await client.messages.parse({
    model,
    max_tokens: 512,
    thinking: { type: "disabled" },
    system,
    output_config: {
      format: {
        type: "json_schema" as const,
        schema: transformJSONSchema(z.toJSONSchema(schema, { reused: "inline" }))
      }
    },
    messages: [...history, { role: "user", content: sentence }]
  });

  const block = response.content.find(b => b.type === "text");
  if (!block) return null;

  try {
    const parsed = schema.safeParse(JSON.parse(block.text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
