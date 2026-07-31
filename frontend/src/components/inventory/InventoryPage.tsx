import {
  Alert,
  Button,
  Container,
  Group,
  Paper,
  ScrollArea,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  Textarea,
  Title,
} from "@mantine/core";
import { IconAlertTriangle, IconSparkles } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { getInventoryGroupedByCategory, interpretInventoryText } from "../../api/inventory";
import { InventoryCategoryGroup } from "../../types";
import { InventoryItemCard } from "./InventoryItemCard";
import classes from "./InventoryPage.module.css";

/**
 * Three category cards per line, which is the layout the page is designed
 * around. It steps down rather than squeezing: below `lg` a third column leaves
 * each card too narrow for an item name beside its three row actions.
 */
const COLUMNS = { base: 1, sm: 2, lg: 3 };

/**
 * The inventory landing page: one input the user types a sentence into, and
 * everything they own underneath it, one card per category.
 *
 * The input is not a chat box — it is the interpreted surface for this module.
 * A sentence goes out, a committed diff comes back, and the field clears; there
 * is no transcript because there is no conversation to keep.
 *
 * Both calls are mocked in `api/inventory.ts` until the routes exist.
 */
export function InventoryPage() {
  const [groups, setGroups] = useState<InventoryCategoryGroup[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const data = await getInventoryGroupedByCategory();
      setGroups(data.groups);
    } catch (error) {
      setGroups(null);
      setLoadError(error instanceof Error ? error.message : "Could not load your inventory.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit() {
    const sentence = text.trim();
    if (!sentence || submitting) return;

    setSubmitting(true);
    setReceipt(null);
    try {
      const result = await interpretInventoryText(sentence);
      // Cleared only on success, so a failed call leaves the user's sentence
      // where they can retry or amend it.
      setText("");
      setReceipt(result.summary);
      // Direct commit: the write already happened, so the list is now stale.
      // This re-fetch is what the WebSocket push will replace.
      await load();
    } catch (error) {
      setReceipt(error instanceof Error ? error.message : "That could not be applied.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    // `xl` rather than `lg`: three columns inside a 975px container leaves each
    // card too tight for a name beside its actions.
    <Container size="xl" className={classes.page}>
      {/* Fixed head: the title and the input stay put while the cards scroll
          under them, so the interpreted surface is always reachable. */}
      <Stack gap="lg" pb="md">
        <div>
          <Title order={2}>Inventory</Title>
          <Text size="sm" c="dimmed">
            What you own, and how much of it is left.
          </Text>
        </div>

        <Paper withBorder radius="md" p="md">
          <Textarea
            value={text}
            onChange={(event) => setText(event.currentTarget.value)}
            // Enter alone would fight the multi-line field; the modifier is the
            // conventional "send" for a textarea.
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder={'Try "Add 1984 to my Books" or "low on eggs and milk, out of bread"'}
            aria-label="Describe an inventory change"
            autosize
            minRows={2}
            maxRows={6}
            disabled={submitting}
          />

          <Group justify="space-between" mt="sm" wrap="nowrap">
            <Text size="xs" c="dimmed">
              {receipt ?? "Plain English. Press ⌘/Ctrl + Enter to send."}
            </Text>
            <Button
              onClick={() => void submit()}
              loading={submitting}
              disabled={!text.trim()}
              leftSection={<IconSparkles size={16} stroke={1.6} />}
            >
              Send
            </Button>
          </Group>
        </Paper>
      </Stack>

      {/* The only scrolling region on the page. `scrollbars="y"` because the
          grid never exceeds the container's width — it drops to fewer columns
          instead. */}
      <ScrollArea
        className={classes.scroll}
        classNames={{ content: classes.scrollContent }}
        type="auto"
        scrollbars="y"
        offsetScrollbars="y"
      >
        {loadError && (
          <Alert
            color="red"
            variant="light"
            radius="md"
            icon={<IconAlertTriangle size={18} stroke={1.6} />}
            title="Inventory did not load"
          >
            <Stack align="flex-start" gap="xs">
              <Text size="sm">{loadError}</Text>
              <Button size="xs" variant="light" color="red" onClick={() => void load()}>
                Try again
              </Button>
            </Stack>
          </Alert>
        )}

        {!groups && !loadError && (
          <SimpleGrid cols={COLUMNS} spacing="md">
            <Skeleton height={220} radius="md" />
            <Skeleton height={220} radius="md" />
            <Skeleton height={220} radius="md" />
          </SimpleGrid>
        )}

        {groups?.length === 0 && (
          <Text size="sm" c="dimmed">
            Nothing tracked yet — describe your first item above.
          </Text>
        )}

        {groups && groups.length > 0 && (
          <SimpleGrid cols={COLUMNS} spacing="md" verticalSpacing="md">
            {groups.map((group) => (
              // Row actions land with the precise-edit routes; the card takes
              // them as optional props so the buttons are already in place.
              <InventoryItemCard
                key={group.category.id}
                category={group.category.name}
                items={group.items}
              />
            ))}
          </SimpleGrid>
        )}
      </ScrollArea>
    </Container>
  );
}
