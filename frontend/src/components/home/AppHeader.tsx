import { ActionIcon, Anchor, Group, Image, Menu, Tooltip } from "@mantine/core";
import {
  IconLogout,
  IconMenu2,
  IconSettings,
  IconShoppingCart,
} from "@tabler/icons-react";
import { View } from "./views";
// The simplified mark, not the full roundel — it stays legible at 40px.
import logoUrl from "../../assets/simple_logo.svg";
import { Wordmark } from "../Wordmark";
import classes from "./AppHeader.module.css";

/** The module links, in order. */
const LINKS: { value: View; label: string }[] = [
  { value: "inventory", label: "INVENTORY" },
  { value: "schedules", label: "SCHEDULE" },
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
        {/* Decorative: the wordmark beside it already names the app. */}
        <Image src={logoUrl} alt="" className={classes.logo} />
        <Wordmark order={2} />
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
              size="lg"
              underline="never"
              fw={active ? 600 : 500}
              // The active colour is the light green accent, applied in the
              // stylesheet off `aria-current` so the marker and the accent
              // cannot drift.
              c={active ? undefined : "dimmed"}
              className={classes.navLink}
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
          {/* A control, so its selected state takes the primary green fill
              rather than the light accent the nav links use — same rule as
              everywhere else.
              Idle it stays grey so the header has one highlight at a time. */}
          <ActionIcon
            variant={view === "cart" ? "light" : "subtle"}
            color={view === "cart" ? "salamander" : "gray"}
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
