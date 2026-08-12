import { Alert, Button, Paper, ScrollArea, Table, Text } from "@mantine/core";
import { IconDeviceFloppy, IconPlus, IconTrash } from "@tabler/icons-react";
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
  | { key: string; op: "delete"; item: InventoryItem; fields: NewInventoryItem };

interface InventoryProposalsTableProps {
  proposals: Proposal[];
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
} satisfies Record<Proposal["op"], { label: string; color?: string; icon: ReactNode }>;

export function InventoryProposalsTable({
  proposals,
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

  async function commit(proposal: Proposal) {
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

  return (
    <Paper withBorder radius="md" p="md">
      <Text fw={600} size="sm" mb="sm">
        Check this before it is saved
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
              const action = ACTIONS[proposal.op];
              const { fields } = proposal;
              return (
                <Table.Tr key={proposal.key}>
                  <Table.Td>{fields.name}</Table.Td>
                  <Table.Td>{categoryName(fields.category_id)}</Table.Td>
                  <Table.Td>{fields.quantity}</Table.Td>
                  <Table.Td>{fields.unit ?? "—"}</Table.Td>
                  <Table.Td>{fields.is_private ? "Yes" : "No"}</Table.Td>
                  <Table.Td>{fields.attributes ?? "—"}</Table.Td>
                  <Table.Td w={110}>
                    <Button
                      size="xs"
                      color={action.color}
                      loading={busyKey === proposal.key}
                      disabled={busyKey !== null && busyKey !== proposal.key}
                      leftSection={action.icon}
                      onClick={() => void commit(proposal)}
                    >
                      {action.label}
                    </Button>
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
