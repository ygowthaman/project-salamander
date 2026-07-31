import { AppShell } from "@mantine/core";
import { useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { AppHeader } from "./AppHeader";
import { View, ViewBody } from "./views";

/**
 * The signed-in shell — where a user lands straight after logging in.
 *
 * AppShell.Header is fixed, so the brand, module tabs, cart and menu stay on
 * screen no matter what; only AppShell.Main swaps as the view changes. There is
 * no router yet, so the active view is plain local state — swap this for route
 * params when one lands.
 */
export function HomePage() {
  const { user, signOut } = useAuth();
  const [view, setView] = useState<View>("inventory");

  return (
    <AppShell header={{ height: 60 }} padding="md">
      <AppShell.Header>
        <AppHeader
          view={view}
          onNavigate={setView}
          onSignOut={() => void signOut()}
          accountLabel={user?.display_name ?? user?.email}
        />
      </AppShell.Header>

      <AppShell.Main>
        <ViewBody view={view} />
      </AppShell.Main>
    </AppShell>
  );
}
