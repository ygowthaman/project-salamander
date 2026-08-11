import "dotenv/config";
import { client, defaultModel } from "../src/agents/client.js";

const response = await client.messages.create({
  model: defaultModel,
  max_tokens: 1024,
  messages: [{ role: "user", content: "Reply with a single word: CONNECTED" }]
});

console.log(JSON.stringify(response, null, 2));
