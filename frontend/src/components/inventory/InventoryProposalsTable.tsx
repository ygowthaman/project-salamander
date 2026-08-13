import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Paper,
  ScrollArea,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconDeviceFloppy, IconEye, IconPlus, IconTrash, IconX } from "@tabler/icons-react";
import { ReactNode, useEffect, useState } from "react";
import { listCategories } from "../../api/categories";
import {
  createInventoryItem,
  deleteInventoryItem,
  updateInventoryItem,
} from "../../api/inventory";
import { Category, InventoryItem, NewInventoryItem } from "../../types";

export type Proposal =
  | { key: string; op: "create"; fields: NewInventoryItem }
  | { key: string; op: "update"; item: InventoryItem; fields: NewInventoryItem }
  | { key: string; op: "delete"; item: InventoryItem; fields: NewInventoryItem }
  | { key: string; op: "match"; item: InventoryItem; fields: NewInventoryItem };

export type CommittableProposal = Exclude<Proposal, { op: "match" }>;

interface InventoryProposalsTableProps {
  proposals: Proposal[];
  onView: (proposal: CommittableProposal) => void;
  onDismiss: (key: string) => void;
  onCommitted: (key: string) => void;
}

const ACTIONS = {
  create: { label: "Save", color: undefined, icon: <IconPlus size={14} stroke={1.6} /> },
  update: {
    label: "Update",
    color: undefined,
    icon: <IconDeviceFloppy size={14} stroke={1.6} />,
  },
  delete: { label: "Delete", color: "red", icon: <IconTrash size={14} stroke={1.6} /> },
} satisfies Record<CommittableProposal["op"], { label: string; color?: string; icon: ReactNode }>;

export function InventoryProposalsTable({
  proposals,
  onView,
  onDismiss,
  onCommitted,
}: InventoryProposalsTableProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listCategories()
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  async function commit(proposal: CommittableProposal) {
    if (busyKey) return;

    setError(null);
    setBusyKey(proposal.key);
    try {
      if (proposal.op === "create") await createInventoryItem(proposal.fields);
      else if (proposal.op === "update") await updateInventoryItem(proposal.item.id, proposal.fields);
      else await deleteInventoryItem(proposal.item.id);
      onCommitted(proposal.key);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That could not be applied.");
    } finally {
      setBusyKey(null);
    }
  }

  if (proposals.length === 0) return null;

  function categoryName(id: string): string {
    return categories.find((category) => category.id === id)?.name ?? "—";
  }

  const heading = proposals.every((proposal) => proposal.op === "match")
    ? "What matched"
    : "Check this before it is saved";

  return (
    <Paper withBorder radius="md" p="md">
      <Text fw={600} size="sm" mb="sm">
        {heading}
      </Text>

      {error && (
        <Alert color="red" variant="light" radius="md" role="alert" mb="sm">
          {error}
        </Alert>
      )}

      <ScrollArea type="auto" scrollbars="x" offsetScrollbars="x">
        <Table verticalSpacing="xs" horizontalSpacing="sm" striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Category</Table.Th>
              <Table.Th>Quantity</Table.Th>
              <Table.Th>Unit</Table.Th>
              <Table.Th>Private</Table.Th>
              <Table.Th>Attributes</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>

          <Table.Tbody>
            {proposals.map((proposal) => {
              const { fields } = proposal;
              return (
                <Table.Tr key={proposal.key}>
                  <Table.Td>{fields.name}</Table.Td>
                  <Table.Td>{categoryName(fields.category_id)}</Table.Td>
                  <Table.Td>{fields.quantity}</Table.Td>
                  <Table.Td>{fields.unit ?? "—"}</Table.Td>
                  <Table.Td>{fields.is_private ? "Yes" : "No"}</Table.Td>
                  <Table.Td>{fields.attributes ?? "—"}</Table.Td>
                  <Table.Td w={190}>
                    <Group gap={4} wrap="nowrap" justify="flex-end">
                      {proposal.op !== "match" && (
                        <>
                          <Button
                            size="xs"
                            color={ACTIONS[proposal.op].color}
                            loading={busyKey === proposal.key}
                            disabled={busyKey !== null && busyKey !== proposal.key}
                            leftSection={ACTIONS[proposal.op].icon}
                            onClick={() => void commit(proposal)}
                          >
                            {ACTIONS[proposal.op].label}
                          </Button>
                          <Tooltip label="Open in the form" withArrow>
                            <ActionIcon
                              variant="subtle"
                              color="gray"
                              aria-label={`Open ${fields.name} in the form`}
                              disabled={busyKey !== null}
                              onClick={() => onView(proposal)}
                            >
                              <IconEye size={16} stroke={1.6} />
                            </ActionIcon>
                          </Tooltip>
                        </>
                      )}
                      <Tooltip label="Dismiss" withArrow>
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          aria-label={`Dismiss ${fields.name}`}
                          disabled={busyKey !== null}
                          onClick={() => onDismiss(proposal.key)}
                        >
                          <IconX size={16} stroke={1.6} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Paper>
  );
}
