import {
  Alert,
  Button,
  Container,
  Group,
  Modal,
  Paper,
  ScrollArea,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import { IconAlertTriangle, IconSparkles } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import {
  deleteInventoryItem,
  getInventoryGroupedByCategory,
  interpretInventoryText,
} from "../../api/inventory";
import {
  Interpretation,
  InventoryCategoryGroup,
  InventoryItem,
  NewInventoryItem,
} from "../../types";
import { InventoryItemCard } from "./InventoryItemCard";
import { InventoryItemForm, ItemFormMode } from "./InventoryItemForm";
import { InventoryProposalsTable, Proposal } from "./InventoryProposalsTable";
import classes from "./InventoryPage.module.css";

const COLUMNS = { base: 1, sm: 2, lg: 3 };

let proposalCount = 0;

function nextProposalKey(): string {
  proposalCount += 1;
  return `proposal-${proposalCount}`;
}

function proposalsFrom(result: Interpretation): Proposal[] {
  switch (result.type) {
    case "create_proposal":
      return result.items.map(
        (fields): Proposal => ({ key: nextProposalKey(), op: "create", fields }),
      );
    case "update_proposal":
      return result.updates.map(
        ({ item, changes }): Proposal => ({
          key: nextProposalKey(),
          op: "update",
          item,
          fields: {
            name: changes.name ?? item.name,
            category_id: changes.category_id ?? item.category_id,
            quantity: changes.quantity ?? item.quantity ?? 1,
            unit: changes.unit ?? item.unit,
            attributes: changes.attributes ?? item.attributes,
            is_private: changes.is_private ?? item.is_private,
          },
        }),
      );
    case "delete_proposal":
      return result.items.map(
        (item): Proposal => ({
          key: nextProposalKey(),
          op: "delete",
          item,
          fields: {
            name: item.name,
            category_id: item.category_id,
            quantity: item.quantity ?? 0,
            unit: item.unit,
            attributes: item.attributes,
            is_private: item.is_private,
          },
        }),
      );
    default:
      return [];
  }
}

function joinNames(names: string[]): string {
  const last = names.slice(-1).join("");
  const rest = names.slice(0, -1);
  return rest.length === 0 ? last : `${rest.join(", ")} and ${last}`;
}

function receiptFor(result: Interpretation): string {
  switch (result.type) {
    case "question":
      return result.question;
    case "items":
      return `${result.total} ${result.total === 1 ? "item" : "items"} matched.`;
    case "create_proposal":
      return `Add ${joinNames(result.items.map((item) => item.name))}?`;
    case "update_proposal":
      return `Change ${joinNames(result.updates.map(({ item }) => item.name))}?`;
    case "delete_proposal":
      return `Remove ${joinNames(result.items.map((item) => item.name))}?`;
  }
}

export function InventoryPage() {
  const [groups, setGroups] = useState<InventoryCategoryGroup[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);

  const [formMode, setFormMode] = useState<ItemFormMode>("create");
  const [selected, setSelected] = useState<InventoryItem | null>(null);
  const [prefill, setPrefill] = useState<NewInventoryItem | null>(null);
  const [openedProposalKey, setOpenedProposalKey] = useState<string | null>(null);

  const [proposals, setProposals] = useState<Proposal[]>([]);

  const [pendingDelete, setPendingDelete] = useState<InventoryItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function openForm(mode: ItemFormMode, item: InventoryItem | null) {
    setFormMode(mode);
    setSelected(item);
    setPrefill(null);
    setOpenedProposalKey(null);
  }

  function openProposal(proposal: Proposal) {
    setOpenedProposalKey(proposal.key);

    switch (proposal.op) {
      case "create":
        setFormMode("create");
        setSelected(null);
        setPrefill({ ...proposal.fields });
        return;
      case "update":
        setFormMode("edit");
        setSelected(proposal.item);
        setPrefill({ ...proposal.fields });
        return;
      case "delete":
        setFormMode("view");
        setSelected(proposal.item);
        setPrefill(null);
    }
  }

  function dismissProposal(key: string) {
    setProposals((pending) => pending.filter((proposal) => proposal.key !== key));
  }

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
      setText("");
      setReceipt(receiptFor(result));
      setProposals(proposalsFrom(result));
      await load();
    } catch (error) {
      setReceipt(error instanceof Error ? error.message : "That could not be applied.");
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete || deleting) return;

    setDeleteError(null);
    setDeleting(true);
    try {
      await deleteInventoryItem(pendingDelete.id);
      if (selected?.id === pendingDelete.id) openForm("create", null);
      setPendingDelete(null);
      await load();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Could not delete that item.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Container size="xl" className={classes.page}>
      <Text size="sm" c="dimmed" pb="md">
        What you own, and how much of it is left.
      </Text>

      <div className={classes.panes}>
        <section className={classes.exchange}>
          <Paper withBorder radius="md" p="md">
            <Textarea
              value={text}
              onChange={(event) => setText(event.currentTarget.value)}
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
                Plain English. Press ⌘/Ctrl + Enter to send.
              </Text>
              <Button
                className={classes.sendButton}
                onClick={() => void submit()}
                loading={submitting}
                disabled={!text.trim()}
                leftSection={<IconSparkles size={16} stroke={1.6} />}
              >
                Send
              </Button>
            </Group>
          </Paper>

          <ScrollArea
            className={classes.scroll}
            classNames={{ content: classes.scrollContent }}
            type="auto"
            scrollbars="y"
            offsetScrollbars="y"
          >
            {receipt && (
              <Paper withBorder radius="md" p="sm">
                <Text size="sm">{receipt}</Text>
              </Paper>
            )}
          </ScrollArea>
        </section>

        <section className={classes.workspace}>
          <InventoryItemForm
            mode={formMode}
            item={selected}
            values={prefill}
            onSaved={() => {
              if (openedProposalKey) dismissProposal(openedProposalKey);
              openForm("create", null);
              void load();
            }}
            onClose={() => openForm("create", null)}
          />

          <InventoryProposalsTable
            proposals={proposals}
            onView={openProposal}
            onDismiss={dismissProposal}
            onCommitted={(key) => {
              dismissProposal(key);
              void load();
            }}
          />

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
                  <InventoryItemCard
                    key={group.category.id}
                    category={group.category.name}
                    items={group.items}
                    onView={(item) => openForm("view", item)}
                    onEdit={(item) => openForm("edit", item)}
                    onDelete={(item) => {
                      setDeleteError(null);
                      setPendingDelete(item);
                    }}
                  />
                ))}
              </SimpleGrid>
            )}
          </ScrollArea>
        </section>
      </div>

      <Modal
        opened={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete this item?"
        centered
        radius="md"
      >
        <Stack gap="md">
          <Text size="sm">
            {pendingDelete?.name} will be removed from your inventory. This cannot be undone.
          </Text>

          {deleteError && (
            <Alert color="red" variant="light" radius="md" role="alert">
              {deleteError}
            </Alert>
          )}

          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={() => setPendingDelete(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button color="red" loading={deleting} onClick={() => void confirmDelete()}>
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Container>
  );
}
