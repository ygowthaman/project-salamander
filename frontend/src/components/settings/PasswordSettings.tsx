import { Alert, Button, Group, Paper, PasswordInput, Stack, Text, Title } from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";
import { useState, FormEvent } from "react";
import { changePassword } from "../../api/auth";
import { useAuth } from "../../auth/useAuth";

const MIN_LENGTH = 12;

export function PasswordSettings() {
  const { user } = useAuth();
  const hasPassword = user?.has_password ?? true;

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ next?: string; confirmation?: string }>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  function clearFeedback() {
    setFieldErrors({});
    setSaveError(null);
    setSaved(false);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (busy) return;

    if (next.length < MIN_LENGTH) {
      setFieldErrors({ next: `Use at least ${MIN_LENGTH} characters` });
      return;
    }
    if (next !== confirmation) {
      setFieldErrors({ confirmation: "These do not match" });
      return;
    }

    clearFeedback();
    setBusy(true);
    try {
      await changePassword(hasPassword ? current : null, next);
      setCurrent("");
      setNext("");
      setConfirmation("");
      setSaved(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not change your password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Paper withBorder radius="md" p="lg">
      <Title order={4} mb="xs">
        {hasPassword ? "Change password" : "Set a password"}
      </Title>
      <Text size="sm" c="dimmed" mb="md">
        Signing in everywhere else ends when you save. This browser stays signed in.
      </Text>

      {saveError && (
        <Alert color="red" variant="light" mb="md" role="alert">
          {saveError}
        </Alert>
      )}

      <form onSubmit={handleSave}>
        <Stack gap="md">
          {hasPassword && (
            <PasswordInput
              label="Current password"
              value={current}
              onChange={(e) => {
                setCurrent(e.currentTarget.value);
                clearFeedback();
              }}
              autoComplete="current-password"
              required
            />
          )}

          <PasswordInput
            label="New password"
            description={`At least ${MIN_LENGTH} characters.`}
            value={next}
            onChange={(e) => {
              setNext(e.currentTarget.value);
              clearFeedback();
            }}
            error={fieldErrors.next}
            autoComplete="new-password"
            minLength={MIN_LENGTH}
            required
          />

          <PasswordInput
            label="Confirm new password"
            value={confirmation}
            onChange={(e) => {
              setConfirmation(e.currentTarget.value);
              clearFeedback();
            }}
            error={fieldErrors.confirmation}
            autoComplete="new-password"
            required
          />

          <Group gap="sm">
            <Button type="submit" loading={busy}>
              {hasPassword ? "Change password" : "Set password"}
            </Button>
            {saved && (
              <Group gap={4} c="dimmed">
                <IconCheck size={16} stroke={1.8} />
                <Text size="sm">Password changed</Text>
              </Group>
            )}
          </Group>
        </Stack>
      </form>
    </Paper>
  );
}
