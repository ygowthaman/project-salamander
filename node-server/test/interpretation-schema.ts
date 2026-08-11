import { interpretation } from "../src/agents/inventory.js";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean) => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}`);
  }
};

const uuid = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const item = {
  name: "1984",
  category_id: uuid,
  unit: null,
  quantity: 1,
  attributes: "unabridged version",
  is_private: false,
};
const ok = (input: unknown) => interpretation.safeParse(input).success;

console.log("\ninterpretation schema");
check("accepts a create_item proposal", ok({ type: "create_item", item }));
check("accepts a find_items by name", ok({ type: "find_items", q: "1984", category_id: null }));
check("accepts a find_items by category", ok({ type: "find_items", q: null, category_id: uuid }));
check("accepts an unfiltered find_items", ok({ type: "find_items", q: null, category_id: null }));
check("accepts a question", ok({ type: "question", question: "Did you mean Books?" }));
check("rejects an unknown type", !ok({ type: "delete_item", item }));
check("rejects a missing type", !ok({ item }));
check(
  "rejects a non-uuid category_id",
  !ok({ type: "create_item", item: { ...item, category_id: "books" } }),
);
check("rejects a zero quantity", !ok({ type: "create_item", item: { ...item, quantity: 0 } }));
check("rejects a null quantity", !ok({ type: "create_item", item: { ...item, quantity: null } }));
check(
  "rejects an absent unit key",
  !ok({
    type: "create_item",
    item: { name: "1984", category_id: uuid, quantity: 1, attributes: null, is_private: false },
  }),
);
check(
  "rejects an injected household_id",
  !ok({ type: "create_item", item: { ...item, household_id: "7f3a" } }),
);
check(
  "rejects an injected limit",
  !ok({ type: "find_items", q: "1984", category_id: null, limit: 500 }),
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
