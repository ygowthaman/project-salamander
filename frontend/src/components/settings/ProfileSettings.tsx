import { Alert, Button, Group, Paper, Stack, Text, TextInput, Title } from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";
import { useState, FormEvent } from "react";
import { updateProfile } from "../../api/auth";
import { useAuth } from "../../auth/useAuth";

export function ProfileSettings() {
  const { user, applyUser } = useAuth();

  const [displayName, setDisplayName] = useState(user?.display_name ?? "");
  const [nameError, setNameError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (busy) return;

    const trimmed = displayName.trim();
    if (!trimmed) {
      setNameError("Tell us what to call you");
      return;
    }

    setNameError(null);
    setSaveError(null);
    setSaved(false);
    setBusy(true);
    try {
      const updated = await updateProfile(trimmed);
      applyUser({ ...user!, ...updated });
      setDisplayName(updated.display_name ?? "");
      setSaved(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save your changes.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Paper withBorder radius="md" p="lg">
      <Title order={4} mb="xs">
        Profile
      </Title>
      <Text size="sm" c="dimmed" mb="md">
        The name everyone in your household sees next to what you add.
      </Text>

      {saveError && (
        <Alert color="red" variant="light" mb="md" role="alert">
          {saveError}
        </Alert>
      )}

      <form onSubmit={handleSave}>
        <Stack gap="md">
          <TextInput
            label="Display name"
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.currentTarget.value);
              if (nameError) setNameError(null);
              setSaved(false);
            }}
            error={nameError}
            maxLength={100}
            required
          />

          <TextInput label="Email" value={user?.email ?? ""} disabled />

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
  );
}
