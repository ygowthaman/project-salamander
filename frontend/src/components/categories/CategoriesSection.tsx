import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Loader,
  Paper,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { IconAlertTriangle, IconCheck, IconPencil, IconTrash, IconX } from "@tabler/icons-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  createCategory,
  deleteCategory,
  listCategories,
  renameCategory,
  searchCategories,
} from "../../api/categories";
import { Category } from "../../types";

const NAME_MAX_LENGTH = 100;
const MATCH_DEBOUNCE_MS = 1000;

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function byName(list: Category[]): Category[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name));
}

export function CategoriesSection() {
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [matches, setMatches] = useState<Category[] | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setCategories(byName(await listCategories()));
    } catch (error) {
      setCategories(null);
      setLoadError(errorText(error, "Could not load your categories."));
    }
  }, []);

  const typedName = newName.trim();

  useEffect(() => {
    setMatches(null);
    if (!typedName) {
      void load();
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      searchCategories(typedName)
        .then((found) => !cancelled && setMatches(byName(found)))
        .catch(() => !cancelled && setMatches([]));
    }, MATCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [typedName, load]);

  const exactMatch =
    matches?.some((category) => category.name.toLowerCase() === typedName.toLowerCase()) ?? false;
  const checkingName = typedName.length > 0 && matches === null;
  const canSave = typedName.length > 0 && matches !== null && !exactMatch;
  const shown = matches ?? categories;

  function replaceInLists(renamed: Category) {
    const swap = (list: Category[] | null) =>
      list && byName(list.map((category) => (category.id === renamed.id ? renamed : category)));
    setCategories(swap);
    setMatches(swap);
  }

  function dropFromLists(id: string) {
    const drop = (list: Category[] | null) =>
      list && list.filter((category) => category.id !== id);
    setCategories(drop);
    setMatches(drop);
  }

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!canSave || adding) return;

    setAddError(null);
    setAdding(true);
    try {
      await createCategory(name);
      setNewName("");
    } catch (error) {
      setAddError(errorText(error, "Could not add that category."));
    } finally {
      setAdding(false);
    }
  }

  function startEdit(category: Category) {
    setRowError(null);
    setEditingId(category.id);
    setEditName(category.name);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName("");
  }

  async function saveEdit(id: string) {
    const name = editName.trim();
    if (!name || busyId) return;

    setRowError(null);
    setBusyId(id);
    try {
      replaceInLists(await renameCategory(id, name));
      cancelEdit();
    } catch (error) {
      setRowError(errorText(error, "Could not rename that category."));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    if (busyId) return;

    setRowError(null);
    setBusyId(id);
    try {
      await deleteCategory(id);
      dropFromLists(id);
    } catch (error) {
      setRowError(errorText(error, "Could not delete that category."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Stack gap="lg">
      <Paper withBorder radius="md" p="md">
        <form onSubmit={handleAdd}>
          <Group gap="sm" align="flex-start" wrap="nowrap">
            <TextInput
              flex={1}
              value={newName}
              onChange={(event) => {
                setNewName(event.currentTarget.value);
                if (addError) setAddError(null);
              }}
              placeholder="Books, Groceries, Cleaning…"
              aria-label="New category name"
              error={addError}
              maxLength={NAME_MAX_LENGTH}
              disabled={adding}
              rightSectionPointerEvents="all"
              rightSectionWidth={checkingName ? 62 : 36}
              rightSection={
                newName ? (
                  <Group gap={4} wrap="nowrap">
                    {checkingName && <Loader size="xs" />}
                    <Tooltip label="Clear">
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        size="sm"
                        aria-label="Clear category search"
                        onClick={() => setNewName("")}
                      >
                        <IconX size={14} stroke={1.6} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                ) : null
              }
            />
            <Button type="submit" loading={adding} disabled={!canSave}>
              Save
            </Button>
          </Group>
        </form>
      </Paper>

      {loadError && (
        <Alert
          color="red"
          variant="light"
          radius="md"
          icon={<IconAlertTriangle size={18} stroke={1.6} />}
          role="alert"
        >
          <Stack align="flex-start" gap="xs">
            <Text size="sm">{loadError}</Text>
            <Button size="xs" variant="light" color="red" onClick={() => void load()}>
              Try again
            </Button>
          </Stack>
        </Alert>
      )}

      {rowError && (
        <Alert color="red" variant="light" radius="md" role="alert">
          {rowError}
        </Alert>
      )}

      {!shown && !loadError && <Skeleton height={160} radius="md" />}

      {shown?.length === 0 && (
        <Text size="sm" c="dimmed">
          {typedName
            ? `Nothing matches “${typedName}” — Save adds it as a new category.`
            : "No categories yet — add your first one above."}
        </Text>
      )}

      {shown && shown.length > 0 && (
        <Paper withBorder radius="md">
          <Table verticalSpacing="sm" horizontalSpacing="md">
            <Table.Tbody>
              {shown.map((category) => {
                const editing = editingId === category.id;
                return (
                  <Table.Tr key={category.id}>
                    <Table.Td>
                      {editing ? (
                        <TextInput
                          value={editName}
                          onChange={(event) => setEditName(event.currentTarget.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void saveEdit(category.id);
                            }
                            if (event.key === "Escape") cancelEdit();
                          }}
                          aria-label={`Rename ${category.name}`}
                          maxLength={NAME_MAX_LENGTH}
                          disabled={busyId === category.id}
                          autoFocus
                        />
                      ) : (
                        <Text size="sm">{category.name}</Text>
                      )}
                    </Table.Td>

                    <Table.Td w={96}>
                      <Group gap="xs" justify="flex-end" wrap="nowrap">
                        {editing ? (
                          <>
                            <Tooltip label="Save">
                              <ActionIcon
                                variant="subtle"
                                color="salamander"
                                aria-label="Save name"
                                loading={busyId === category.id}
                                disabled={!editName.trim()}
                                onClick={() => void saveEdit(category.id)}
                              >
                                <IconCheck size={16} stroke={1.6} />
                              </ActionIcon>
                            </Tooltip>
                            <Tooltip label="Cancel">
                              <ActionIcon
                                variant="subtle"
                                color="gray"
                                aria-label="Cancel rename"
                                onClick={cancelEdit}
                              >
                                <IconX size={16} stroke={1.6} />
                              </ActionIcon>
                            </Tooltip>
                          </>
                        ) : (
                          <>
                            <Tooltip label="Edit">
                              <ActionIcon
                                variant="subtle"
                                color="gray"
                                aria-label={`Edit ${category.name}`}
                                onClick={() => startEdit(category)}
                              >
                                <IconPencil size={16} stroke={1.6} />
                              </ActionIcon>
                            </Tooltip>
                            <Tooltip label="Delete">
                              <ActionIcon
                                variant="subtle"
                                color="red"
                                aria-label={`Delete ${category.name}`}
                                loading={busyId === category.id}
                                onClick={() => void remove(category.id)}
                              >
                                <IconTrash size={16} stroke={1.6} />
                              </ActionIcon>
                            </Tooltip>
                          </>
                        )}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Paper>
      )}
    </Stack>
  );
}
