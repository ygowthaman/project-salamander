import { Paper, Stack, Text, Title } from "@mantine/core";

/**
 * A settings section that is listed but not built.
 *
 * Says what will be here rather than showing an empty form, so the section reads
 * as unfinished rather than broken — and so nobody wires a control to a route
 * that does not exist yet.
 */
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
