import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const model = "claude-sonnet-5";

const response = await client.messages.create({
    model: model,
    max_tokens: 1024,
    messages: [{role: "user", content: "Reply with a single word: CONNECTED"}]
});

console.log(JSON.stringify(response, null, 2));