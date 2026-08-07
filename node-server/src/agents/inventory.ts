import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { inventoryItem } from "../domain/inventory.js";

const client = new Anthropic();

const model = "claude-sonnet-5";

const proposedItem = inventoryItem.extend({
    unit: inventoryItem.shape.unit.nullable(),
    attributes: inventoryItem.shape.attributes.nullable(),
    quantity: inventoryItem.shape.quantity.min(1),
}).strict();