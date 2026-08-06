import {
  Alert,
  Anchor,
  Button,
  Group,
  Modal,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useState, FormEvent } from "react";
import { createHousehold } from "../../api/households";
import { useAuth } from "../../auth/useAuth";

interface HouseholdSetupModalProps {
  opened: boolean;
  onClose: () => void;
  firstRun?: boolean;
}

export function HouseholdSetupModal({ opened, onClose, firstRun }: HouseholdSetupModalProps) {
  const { applyUser } = useAuth();

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;

    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("Give your household a name");
      return;
    }

    setNameError(null);
    setError(null);
    setBusy(true);
    try {
      const result = await createHousehold({ name: trimmed, address: address.trim() || null });
      applyUser(result.user);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      withCloseButton={!firstRun}
      closeOnClickOutside={!firstRun}
      closeOnEscape={!firstRun}
      centered
      title={firstRun ? "Set up your household" : "Create your household"}
      size="md"
    >
      <Text size="sm" c="dimmed" mb="md">
        Salamander keeps your inventory, budgets and spending under a household. Name yours now, or
        skip and do it later — you can invite people to it once it exists.
      </Text>

      {error && (
        <Alert color="red" variant="light" mb="md" role="alert">
          {error}
        </Alert>
      )}

      <form onSubmit={handleSubmit}>
        <Stack gap="md">
          <TextInput
            label="Household name"
            placeholder="Home"
            value={name}
            onChange={(e) => {
              setName(e.currentTarget.value);
              if (nameError) setNameError(null);
            }}
            error={nameError}
            maxLength={100}
            data-autofocus
            required
          />

          <Textarea
            label="Address"
            description="Optional"
            placeholder="Where the household is"
            value={address}
            onChange={(e) => setAddress(e.currentTarget.value)}
            maxLength={500}
            autosize
            minRows={2}
            maxRows={4}
          />

          <Group justify="space-between" mt="xs">
            <Anchor component="button" type="button" size="sm" c="dimmed" onClick={onClose}>
              {firstRun ? "Skip for now" : "Cancel"}
            </Anchor>

            <Button type="submit" loading={busy}>
              Create household
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
