import { Center, Stack, Text, Title } from "@mantine/core";
import { IconCalendarClock, IconSettings, IconShoppingCart } from "@tabler/icons-react";
import { ReactNode } from "react";
import { InventoryPage } from "../inventory/InventoryPage";

/** Every destination the header can switch the viewport to. */
export type View = "inventory" | "schedules" | "cart" | "settings";

function Placeholder({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <Center h="100%" mih={320}>
      <Stack align="center" gap="xs" c="dimmed">
        {icon}
        <Title order={3} c="var(--mantine-color-text)">
          {title}
        </Title>
        <Text size="sm" ta="center" maw={420}>
          {body}
        </Text>
      </Stack>
    </Center>
  );
}

export function SchedulesView() {
  return (
    <Placeholder
      icon={<IconCalendarClock size={40} stroke={1.4} />}
      title="Schedules"
      body="Recurring restocks and when they next run."
    />
  );
}

export function CartView() {
  return (
    <Placeholder
      icon={<IconShoppingCart size={40} stroke={1.4} />}
      title="Cart"
      body="Items assembled for you to review and check out yourself."
    />
  );
}

export function SettingsView() {
  return (
    <Placeholder
      icon={<IconSettings size={40} stroke={1.4} />}
      title="Settings"
      body="Account and app preferences."
    />
  );
}

/** Maps the active view onto the component that fills the viewport below the header. */
export function ViewBody({ view }: { view: View }) {
  switch (view) {
    case "inventory":
      return <InventoryPage />;
    case "schedules":
      return <SchedulesView />;
    case "cart":
      return <CartView />;
    case "settings":
      return <SettingsView />;
  }
}
