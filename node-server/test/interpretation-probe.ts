import "dotenv/config";
import { interpret, type Category } from "../src/agents/inventory.js";

const categories: Category[] = [
  { id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301", name: "Books" },
  { id: "5c3a1b2e-8d47-4e19-b6f2-9a0c0305e82c", name: "Groceries" },
];

const sentences = [
  "add 1 dozen of large brown eggs",
  "add 2 litres of milk",
  "what books do we have?",
  "we are down to 1 litre of milk",
  "throw out the milk",
  "the thing from yesterday",
];

for (const sentence of sentences) {
  const result = await interpret(sentence, categories);
  console.log(`\n${sentence}`);
  console.log(JSON.stringify(result, null, 2));
}
