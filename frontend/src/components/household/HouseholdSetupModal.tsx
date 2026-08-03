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
  /**
   * The first-entry prompt, as opposed to the same form reached later from
   * Settings.
   *
   * It changes how the modal may be dismissed. On first entry **skipping is an
   * answer, not a deferral** — the form does not return on the next sign-in — so
   * the only ways out are the two controls at the bottom and a stray Escape
   * cannot silently answer. Opened deliberately from Settings it is an ordinary
   * dialog the user may cancel however they like.
   */
  firstRun?: boolean;
}

/**
 * The household setup form: shown once on first entry, and reachable afterwards
 * from Settings by a user who skipped it.
 *
 * **It is offered to the user and guaranteed by the system, and those two facts
 * are deliberately different.** The user sees an optional step they may skip;
 * behind them a household already exists either way, named after the local part
 * of their email. Someone who skips never has to think about households at all.
 * The alternative — letting a user exist without one — would mean every part of
 * the app that reads data handling two shapes of ownership, one for lone users
 * and one for households.
 *
 * So there is nothing to create and nothing to undo here. Submitting renames the
 * row the user already has; skipping leaves it alone. Neither branch moves any
 * data, which is why this can be dismissed with no consequences at all — and why
 * a user who comes back to it later is not migrating anything, however much the
 * wording says "create".
 *
 * A user arriving by invitation never sees this: they are joining a household
 * that already exists and were told which one before they accepted.
 */
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

    // Mirrors the server's zod rule so an all-whitespace name is caught before a
    // round-trip; the server remains the actual enforcer.
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
      // `skip_household` is now false, which is what stops the rest of the app
      // from treating this person as someone who does not know they have a
      // household — and what makes the Settings screen switch from the create
      // prompt to the real household form. Putting the row back into auth state
      // avoids a refetch.
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
      // On first entry the three dismissal routes Mantine offers by default are
      // all turned off, so the only ways out are the two controls at the bottom
      // and the answer is always deliberate. Opened from Settings it behaves
      // like any other dialog.
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
