import { Paper, Stack, Text, Title } from "@mantine/core";

export function SettingsPlaceholder({ title, body }: { title: string; body: string }) {
  return (
    <Paper withBorder radius="md" p="lg">
      <Stack gap="xs">
        <Title order={4}>{title}</Title>
        <Text size="sm" c="dimmed" maw={520}>
          {body}
        </Text>
        <Text size="xs" c="dimmed">
          Not built yet.
        </Text>
      </Stack>
    </Paper>
  );
}
