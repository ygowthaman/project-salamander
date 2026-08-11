import "dotenv/config";
import { interpretInventory, type Category } from "../src/agents/inventory.js";
import { interpretCategory } from "../src/agents/category.js";

const categories: Category[] = [
  { id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301", name: "Books" },
  { id: "5c3a1b2e-8d47-4e19-b6f2-9a0c0305e82c", name: "Groceries" },
];

const inventorySentences = [
  "add 1 dozen of large brown eggs",
  "add 2 litres of milk",
  "what books do we have?",
  "we are down to 1 litre of milk",
  "throw out the milk",
  "the thing from yesterday",
];

for (const sentence of inventorySentences) {
  const result = await interpretInventory(sentence, categories);
  console.log(`\n${sentence}`);
  console.log(JSON.stringify(result, null, 2));
}

const categorySentences = [
  "Do I have books?",
  "Add items as produce",
  "Rename produce to groceries",
  "Remove DVDs"
];

for (const sentence of categorySentences) {
  const result = await interpretCategory(sentence);
  console.log(`\n${sentence}`);
  console.log(JSON.stringify(result, null, 2));
}
