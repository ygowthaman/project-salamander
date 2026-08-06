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
import { HouseholdDangerZone, type DepartureKind } from "./HouseholdDangerZone";
import { HouseholdMembers } from "./HouseholdMembers";

export function HouseholdSettings() {
  const { user } = useAuth();
  const skipped = user?.skip_household ?? false;

  const [detail, setDetail] = useState<HouseholdDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [departure, setDeparture] = useState<{ from: string; kind: DepartureKind } | null>(null);

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

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (busy) return;

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
        {departure && (
          <Alert color="green" variant="light" icon={<IconCheck size={18} />} role="status">
            {departure.kind === "deleted"
              ? `You have deleted ${departure.from} and everything it was tracking. Everyone who was in it keeps their account.`
              : departure.kind === "left-dissolved"
                ? `You have left ${departure.from}, and because you were its last admin it was deleted along with everything in it.`
                : `You have left ${departure.from}. Everything you added stays with it.`}{" "}
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

      {detail.role === "admin" && <HouseholdMembers />}

      <HouseholdDangerZone
        detail={detail}
        onDeparted={(kind) => setDeparture({ from: detail.name, kind })}
      />
    </Stack>
  );
}
