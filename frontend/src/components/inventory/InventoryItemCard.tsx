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

const ITEM_LIST_MAX_HEIGHT = 280;

interface InventoryItemCardProps {
  category: string;
  items: InventoryItem[];
  onView?: (item: InventoryItem) => void;
  onEdit?: (item: InventoryItem) => void;
  onDelete?: (item: InventoryItem) => void;
}

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

      <ScrollArea.Autosize
        mah={ITEM_LIST_MAX_HEIGHT}
        type="auto"
        scrollbars="y"
        offsetScrollbars="y"
        classNames={{ content: classes.content }}
      >
        <Stack gap={0}>
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

function stockLabel(item: InventoryItem): string {
  if (item.quantity === null) return item.unit ? `Count unknown · ${item.unit}` : "Count unknown";
  if (item.quantity === 0) return item.unit ? `Out of stock · 0 ${item.unit}` : "Out of stock";
  return item.unit ? `${item.quantity} ${item.unit}` : `${item.quantity}`;
}
