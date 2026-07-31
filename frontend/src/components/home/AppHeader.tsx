import { ActionIcon, Anchor, Box, Group, Menu, Text, Tooltip } from "@mantine/core";
import {
  IconLogout,
  IconMenu2,
  IconSettings,
  IconShoppingCart,
} from "@tabler/icons-react";
import { View } from "./views";
import classes from "./AppHeader.module.css";

/** The module links, in order. */
const LINKS: { value: View; label: string }[] = [
  { value: "inventory", label: "Inventory" },
  { value: "schedules", label: "Schedules" },
];

interface AppHeaderProps {
  view: View;
  onNavigate: (view: View) => void;
  onSignOut: () => void;
  /** Shown as the dropdown's label so the header itself stays uncluttered. */
  accountLabel?: string;
}

export function AppHeader({ view, onNavigate, onSignOut, accountLabel }: AppHeaderProps) {
  return (
    <Group h="100%" px="md" gap="xl" wrap="nowrap">
      <Group gap="sm" wrap="nowrap">
        {/* Reserved for the logo — swap this for an <img> when there is one. */}
        <Box className={classes.logo} aria-hidden>
          🦎
        </Box>
        <Text fw={700} size="lg" className={classes.brand}>
          Salamander
        </Text>
      </Group>

      {/* No router yet, so these are buttons wearing link styling — swap
          `component`/`href` for the router's Link when one lands. */}
      <Group component="nav" aria-label="Modules" gap="lg" wrap="nowrap" className={classes.nav}>
        {LINKS.map((link) => {
          const active = view === link.value;
          return (
            <Anchor
              key={link.value}
              component="button"
              type="button"
              size="sm"
              underline="never"
              fw={active ? 600 : 500}
              c={active ? "var(--mantine-color-text)" : "dimmed"}
              aria-current={active ? "page" : undefined}
              onClick={() => onNavigate(link.value)}
            >
              {link.label}
            </Anchor>
          );
        })}
      </Group>

      <Group gap="xs" wrap="nowrap" ml="auto">
        <Tooltip label="Cart">
          <ActionIcon
            variant={view === "cart" ? "light" : "subtle"}
            color="gray"
            size="lg"
            aria-label="Cart"
            onClick={() => onNavigate("cart")}
          >
            <IconShoppingCart size={20} stroke={1.6} />
          </ActionIcon>
        </Tooltip>

        <Menu position="bottom-end" shadow="md" width={200} withinPortal>
          <Menu.Target>
            <ActionIcon variant="subtle" color="gray" size="lg" aria-label="Menu">
              <IconMenu2 size={20} stroke={1.6} />
            </ActionIcon>
          </Menu.Target>

          <Menu.Dropdown>
            {accountLabel && <Menu.Label>{accountLabel}</Menu.Label>}
            <Menu.Item
              leftSection={<IconSettings size={16} stroke={1.6} />}
              onClick={() => onNavigate("settings")}
            >
              Settings
            </Menu.Item>
            <Menu.Divider />
            <Menu.Item
              color="red"
              leftSection={<IconLogout size={16} stroke={1.6} />}
              onClick={onSignOut}
            >
              Logout
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
    </Group>
  );
}
