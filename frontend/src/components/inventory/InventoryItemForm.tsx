import {
  ActionIcon,
  Alert,
  Button,
  Checkbox,
  Collapse,
  Group,
  NumberInput,
  Paper,
  Select,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconChevronDown,
  IconChevronUp,
  IconDeviceFloppy,
  IconPlus,
  IconX,
} from "@tabler/icons-react";
import { FormEvent, useEffect, useState } from "react";
import { listCategories } from "../../api/categories";
import { createInventoryItem, updateInventoryItem } from "../../api/inventory";
import { Category, InventoryItem } from "../../types";

const NAME_MAX_LENGTH = 200;
const UNIT_MAX_LENGTH = 50;
const ATTRIBUTES_MAX_LENGTH = 500;

export type ItemFormMode = "create" | "edit" | "view";

interface InventoryItemFormProps {
  mode: ItemFormMode;
  item: InventoryItem | null;
  onSaved: () => void;
  onClose: () => void;
}

function optionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function headingFor(mode: ItemFormMode, item: InventoryItem | null): string {
  if (mode === "create" || !item) return "Add an item";
  return mode === "view" ? item.name : `Edit ${item.name}`;
}

export function InventoryItemForm({ mode, item, onSaved, onClose }: InventoryItemFormProps) {
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [opened, setOpened] = useState(false);

  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState<string | number>(1);
  const [unit, setUnit] = useState("");
  const [attributes, setAttributes] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listCategories()
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    setError(null);
    if (!item) {
      setName("");
      setCategoryId(null);
      setQuantity(1);
      setUnit("");
      setAttributes("");
      setIsPrivate(false);
      return;
    }
    setName(item.name);
    setCategoryId(item.category_id);
    setQuantity(item.quantity ?? 1);
    setUnit(item.unit ?? "");
    setAttributes(item.attributes ?? "");
    setIsPrivate(item.is_private);
    setOpened(true);
  }, [item, mode]);

  const readOnly = mode === "view";
  const canSave = name.trim().length > 0 && categoryId !== null && Number(quantity) >= 1;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (readOnly || !canSave || saving) return;

    const fields = {
      name: name.trim(),
      category_id: categoryId!,
      quantity: Number(quantity),
      unit: optionalText(unit),
      attributes: optionalText(attributes),
      is_private: isPrivate,
    };

    setError(null);
    setSaving(true);
    try {
      if (mode === "edit" && item) await updateInventoryItem(item.id, fields);
      else await createInventoryItem(fields);
      onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save that item.");
    } finally {
      setSaving(false);
    }
  }

  if (!categories) {
    return <Skeleton height={160} radius="md" />;
  }

  const fieldProps = {
    readOnly,
    variant: readOnly ? ("unstyled" as const) : undefined,
    disabled: saving,
  };

  return (
    <Paper withBorder radius="md" p="md">
      <Group justify="space-between" wrap="nowrap" mb={opened ? "sm" : 0}>
        <Text fw={600} size="sm" truncate>
          {headingFor(mode, item)}
        </Text>
        <Group gap={4} wrap="nowrap">
          {item && (
            <Tooltip label="Back to adding" withArrow>
              <ActionIcon variant="subtle" color="gray" aria-label="Back to adding" onClick={onClose}>
                <IconX size={16} stroke={1.6} />
              </ActionIcon>
            </Tooltip>
          )}
          <ActionIcon
            variant="subtle"
            color="gray"
            aria-label={opened ? "Collapse the form" : "Expand the form"}
            onClick={() => setOpened((wasOpen) => !wasOpen)}
          >
            {opened ? <IconChevronUp size={16} stroke={1.6} /> : <IconChevronDown size={16} stroke={1.6} />}
          </ActionIcon>
        </Group>
      </Group>

      <Collapse in={opened}>
        {categories.length === 0 ? (
          <Alert
            color="yellow"
            variant="light"
            radius="md"
            icon={<IconAlertTriangle size={18} stroke={1.6} />}
          >
            Add a category in Organize before adding an item.
          </Alert>
        ) : (
          <form onSubmit={handleSubmit}>
            <Stack gap="sm">
              <Group gap="sm" align="flex-start" grow wrap="wrap">
                <TextInput
                  label="Name"
                  value={name}
                  onChange={(event) => setName(event.currentTarget.value)}
                  placeholder="Eggs, 1984, printer ink…"
                  maxLength={NAME_MAX_LENGTH}
                  required={!readOnly}
                  {...fieldProps}
                />
                <Select
                  label="Category"
                  value={categoryId}
                  onChange={setCategoryId}
                  data={categories.map((category) => ({
                    value: category.id,
                    label: category.name,
                  }))}
                  placeholder="Pick one"
                  searchable={!readOnly}
                  rightSection={readOnly ? <span /> : undefined}
                  required={!readOnly}
                  {...fieldProps}
                />
              </Group>

              <Group gap="sm" align="flex-start" grow wrap="wrap">
                <NumberInput
                  label="Quantity"
                  value={quantity}
                  onChange={setQuantity}
                  min={1}
                  clampBehavior="strict"
                  allowDecimal={false}
                  hideControls={readOnly}
                  required={!readOnly}
                  {...fieldProps}
                />
                <TextInput
                  label="Unit"
                  value={unit}
                  onChange={(event) => setUnit(event.currentTarget.value)}
                  placeholder="each, litres, loaves"
                  maxLength={UNIT_MAX_LENGTH}
                  {...fieldProps}
                />
              </Group>

              <TextInput
                label="Attributes"
                value={attributes}
                onChange={(event) => setAttributes(event.currentTarget.value)}
                placeholder="George Orwell, paperback"
                maxLength={ATTRIBUTES_MAX_LENGTH}
                {...fieldProps}
              />

              {error && (
                <Alert color="red" variant="light" radius="md" role="alert">
                  {error}
                </Alert>
              )}

              <Group justify="space-between" wrap="nowrap">
                <Checkbox
                  label="Private"
                  checked={isPrivate}
                  onChange={(event) => setIsPrivate(event.currentTarget.checked)}
                  readOnly={readOnly}
                  disabled={saving}
                />
                {!readOnly && (
                  <Button
                    type="submit"
                    loading={saving}
                    disabled={!canSave}
                    leftSection={
                      mode === "edit" ? (
                        <IconDeviceFloppy size={16} stroke={1.6} />
                      ) : (
                        <IconPlus size={16} stroke={1.6} />
                      )
                    }
                  >
                    {mode === "edit" ? "Update" : "Add"}
                  </Button>
                )}
              </Group>
            </Stack>
          </form>
        )}
      </Collapse>
    </Paper>
  );
}
