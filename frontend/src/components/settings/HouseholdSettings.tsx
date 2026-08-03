import {
  Alert,
  Button,
  Group,
  Paper,
  Skeleton,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { IconAlertTriangle, IconCheck } from "@tabler/icons-react";
import { useCallback, useEffect, useState, FormEvent } from "react";
import { getHousehold, updateHousehold } from "../../api/households";
import { useAuth } from "../../auth/useAuth";
import { HouseholdDetail } from "../../types";
import { HouseholdSetupModal } from "../household/HouseholdSetupModal";
import { HouseholdDangerZone } from "./HouseholdDangerZone";
import { HouseholdMembers } from "./HouseholdMembers";

/**
 * The Household section of Settings.
 *
 * Three shapes, decided by two facts about the caller:
 *
 *   - **`skip_household` is true** — they were given a household silently and do
 *     not know it exists. They get an invitation to create one and *nothing
 *     else*: no name, no address, no member list. Showing any of it would mean
 *     showing a household they never chose, named after their email address,
 *     which is the one thing that flag exists to prevent. Nothing is fetched
 *     either, so the name cannot leak through a loading state.
 *   - **Any member** — the household's name and address, both editable. Renaming
 *     is not an admin power: the role governs who is in the household and
 *     whether it continues to exist, and neither of those is a name.
 *   - **Admins** — additionally the member list and the invite form, below.
 */
export function HouseholdSettings() {
  const { user } = useAuth();
  const skipped = user?.skip_household ?? false;

  const [detail, setDetail] = useState<HouseholdDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  /**
   * Set once a departure completes. Leaving flips `skip_household` back to true,
   * so this section immediately re-renders as the create prompt — which on its
   * own would look like the household simply vanished. This is what says
   * otherwise.
   */
  const [departure, setDeparture] = useState<{ from: string; destroyed: boolean } | null>(null);

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (skipped) {
      setDetail(null);
      return;
    }
    setLoadError(null);
    try {
      const data = await getHousehold();
      setDetail(data);
      setName(data.name);
      setAddress(data.address ?? "");
    } catch (error) {
      setDetail(null);
      setLoadError(error instanceof Error ? error.message : "Could not load your household.");
    }
  }, [skipped]);

  // Re-runs when `skipped` flips, which is what swaps the create prompt for the
  // real form the moment the setup modal succeeds.
  useEffect(() => {
    void load();
  }, [load]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (busy) return;

    // Mirrors the server's rule so an all-whitespace name is caught before a
    // round-trip. A household always has a name — it is what every list and
    // header calls the scope, so there is no null to render around.
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("Give your household a name");
      return;
    }

    setNameError(null);
    setSaveError(null);
    setSaved(false);
    setBusy(true);
    try {
      const updated = await updateHousehold({ name: trimmed, address: address.trim() || null });
      setDetail((current) => (current ? { ...current, ...updated } : current));
      setName(updated.name);
      setAddress(updated.address ?? "");
      setSaved(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save your changes.");
    } finally {
      setBusy(false);
    }
  }

  if (skipped) {
    return (
      <Stack gap="lg">
        {/* Says what left them, never where they landed. A departing member is
            put into a household of their own with `skip_household` back to
            true, and that is exactly the state in which the concept is hidden:
            telling them about it here would introduce a household at the moment
            they stopped having one they knew about. From their side they are
            simply an individual user again, starting empty. */}
        {departure && (
          <Alert color="green" variant="light" icon={<IconCheck size={18} />} role="status">
            You have left {departure.from}
            {departure.destroyed
              ? ", and because you were its last admin it was deleted along with everything in it."
              : ". Everything you added stays with it."}{" "}
            You are starting fresh with an empty inventory.
          </Alert>
        )}

        <Paper withBorder radius="md" p="lg">
          <Stack gap="sm" align="flex-start">
            <Title order={4}>Create a household</Title>
            <Text size="sm" c="dimmed" maw={520}>
              A household is what your inventory, budgets and spending belong to. Create one to give
              it a name and an address, and to invite the people you live with.
            </Text>
            <Button mt="xs" onClick={() => setCreateOpen(true)}>
              Create a household
            </Button>
          </Stack>
        </Paper>

        <HouseholdSetupModal opened={createOpen} onClose={() => setCreateOpen(false)} />
      </Stack>
    );
  }

  if (loadError) {
    return (
      <Alert color="red" variant="light" icon={<IconAlertTriangle size={18} />} role="alert">
        {loadError}
      </Alert>
    );
  }

  if (!detail) {
    return <Skeleton height={220} radius="md" />;
  }

  return (
    <Stack gap="lg">
      <Paper withBorder radius="md" p="lg">
        <Title order={4} mb="xs">
          Household
        </Title>
        <Text size="sm" c="dimmed" mb="md">
          {detail.member_count === 1
            ? "You are the only member."
            : `${detail.member_count} members.`}
        </Text>

        {saveError && (
          <Alert color="red" variant="light" mb="md" role="alert">
            {saveError}
          </Alert>
        )}

        <form onSubmit={handleSave}>
          <Stack gap="md">
            <TextInput
              label="Name"
              value={name}
              onChange={(e) => {
                setName(e.currentTarget.value);
                if (nameError) setNameError(null);
                setSaved(false);
              }}
              error={nameError}
              maxLength={100}
              required
            />

            <Textarea
              label="Address"
              description="Optional"
              placeholder="Where the household is"
              value={address}
              onChange={(e) => {
                setAddress(e.currentTarget.value);
                setSaved(false);
              }}
              maxLength={500}
              autosize
              minRows={2}
              maxRows={4}
            />

            <Group gap="sm">
              <Button type="submit" loading={busy}>
                Save changes
              </Button>
              {saved && (
                <Group gap={4} c="dimmed">
                  <IconCheck size={16} stroke={1.8} />
                  <Text size="sm">Saved</Text>
                </Group>
              )}
            </Group>
          </Stack>
        </form>
      </Paper>

      {/* Membership is the admin's business: inviting, removing and changing
          roles are the powers the role actually carries. A plain member sees the
          household's name and address above and nothing below. The server
          enforces the same split — this only decides what is worth rendering. */}
      {detail.role === "admin" && <HouseholdMembers />}

      {/* Leaving is open to both roles; deleting the household is gated to
          admins inside. Both carry the warnings the PRD requires in front of
          them, because the last-admin case turns "remove me" into "destroy
          this for everyone" without saying so. */}
      <HouseholdDangerZone
        detail={detail}
        onLeft={(destroyed) => setDeparture({ from: detail.name, destroyed })}
      />
    </Stack>
  );
}
