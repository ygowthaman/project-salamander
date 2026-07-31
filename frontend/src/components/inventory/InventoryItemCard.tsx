import {
  ActionIcon,
  Badge,
  Card,
  Group,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { IconEye, IconPencil, IconSearch, IconTrash } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { InventoryItem } from "../../types";
import classes from "./InventoryItemCard.module.css";

/**
 * About four item rows before the list starts scrolling. Chosen so a card with
 * one item and a card with fifty end up the same height in the grid.
 */
const ITEM_LIST_MAX_HEIGHT = 280;

interface InventoryItemCardProps {
  /** The category this card is the whole of — one card per group. */
  category: string;
  items: InventoryItem[];
  onView?: (item: InventoryItem) => void;
  onEdit?: (item: InventoryItem) => void;
  onDelete?: (item: InventoryItem) => void;
}

/**
 * One category's items. The search box filters *within* the card and nothing
 * else: it is a way to find a row in a long collection, not the app's
 * natural-language inventory search, which is a separate interpreted call whose
 * results are their own list.
 */
export function InventoryItemCard({
  category,
  items,
  onView,
  onEdit,
  onDelete,
}: InventoryItemCardProps) {
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => item.name.toLowerCase().includes(needle));
  }, [items, query]);

  return (
    <Card withBorder p="lg" radius="md" className={classes.card}>
      {/* Category Name, then the search bar full-width beneath it — the card is
          one column of a three-up grid, so the two cannot share a row. */}
      <Stack gap="sm" mb="md">
        <Group gap="xs" wrap="nowrap">
          <Text fw={600} size="lg" truncate className={classes.category} c="var(--salamander-green-light)">
            {category}
          </Text>
          <Badge variant="light" color="gray" radius="sm">
            {items.length}
          </Badge>
        </Group>

        <TextInput
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder={`Find in ${category}`}
          aria-label={`Find in ${category}`}
          size="xs"
          leftSection={<IconSearch size={14} stroke={1.6} />}
          w="100%"
          classNames={{ input: classes.searchInput }}
        />
      </Stack>

      {/* Capped, not free-growing: an auto-height CSS grid row takes the height
          of its tallest card and stretches the rest to match, so one 20-item
          category would leave its two neighbours as near-empty boxes and push
          the next row of categories off screen. `type="auto"` keeps the bar
          visible whenever it overflows rather than only on hover.

          `scrollbars="y"` because a row never scrolls sideways — a long item
          name truncates instead. `offsetScrollbars="y"` reserves the bar's
          width so it sits beside the row actions rather than over them. */}
      <ScrollArea.Autosize
        mah={ITEM_LIST_MAX_HEIGHT}
        type="auto"
        scrollbars="y"
        offsetScrollbars="y"
        classNames={{ content: classes.content }}
      >
        <Stack gap={0}>
          {/* For each item => Item name <space-between> view/edit/delete buttons*/}
          {visible.map((item) => (
            <Group
              key={item.id}
              justify="space-between"
              className={classes.item}
              wrap="nowrap"
              gap="sm"
            >
              <div className={classes.itemText}>
                <Text size="sm" fw={500} truncate>
                  {item.name}
                </Text>
                <Text size="xs" c="dimmed">
                  {stockLabel(item)}
                </Text>
              </div>

              <Group gap={4} wrap="nowrap">
                <Tooltip label="View" withArrow>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    aria-label={`View ${item.name}`}
                    onClick={() => onView?.(item)}
                  >
                    <IconEye size={16} stroke={1.6} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Edit" withArrow>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    aria-label={`Edit ${item.name}`}
                    onClick={() => onEdit?.(item)}
                  >
                    <IconPencil size={16} stroke={1.6} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Delete" withArrow>
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    aria-label={`Delete ${item.name}`}
                    onClick={() => onDelete?.(item)}
                  >
                    <IconTrash size={16} stroke={1.6} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Group>
          ))}

          {visible.length === 0 && (
            <Text size="sm" c="dimmed" py="xs">
              {items.length === 0
                ? "Nothing tracked in this category yet."
                : `No item here matches "${query.trim()}".`}
            </Text>
          )}
        </Stack>
      </ScrollArea.Autosize>
    </Card>
  );
}

/**
 * `quantity: null` is "tracked, count unknown" — a legitimate state the schema
 * allows on purpose, so it must not render as 0. The unit is free text and
 * optional, hence the two-part join rather than a template.
 */
function stockLabel(item: InventoryItem): string {
  if (item.quantity === null) return item.unit ? `Count unknown · ${item.unit}` : "Count unknown";
  if (item.quantity === 0) return item.unit ? `Out of stock · 0 ${item.unit}` : "Out of stock";
  return item.unit ? `${item.quantity} ${item.unit}` : `${item.quantity}`;
}
