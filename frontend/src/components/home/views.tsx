import { Center, Stack, Text, Title } from "@mantine/core";
import { IconShoppingCart } from "@tabler/icons-react";
import { ReactNode } from "react";
import { HouseholdPage } from "../household/HouseholdPage";
import { InventoryPage } from "../inventory/InventoryPage";
import { SettingsPage } from "../settings/SettingsPage";

export type View = "inventory" | "household" | "cart" | "settings";

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

export function CartView() {
  return (
    <Placeholder
      icon={<IconShoppingCart size={40} stroke={1.4} />}
      title="Cart"
      body="Items assembled for you to review and check out yourself."
    />
  );
}

export function ViewBody({ view }: { view: View }) {
  switch (view) {
    case "inventory":
      return <InventoryPage />;
    case "household":
      return <HouseholdPage />;
    case "cart":
      return <CartView />;
    case "settings":
      return <SettingsPage />;
  }
}
