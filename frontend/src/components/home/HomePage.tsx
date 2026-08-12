import { AppShell } from "@mantine/core";
import { useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { HouseholdSetupModal } from "../household/HouseholdSetupModal";
import { AppHeader } from "./AppHeader";
import { View, ViewBody } from "./views";

export function HomePage() {
  const { user, signOut, promptHousehold, dismissHouseholdPrompt } = useAuth();
  const [view, setView] = useState<View>("inventory");

  return (
    <AppShell header={{ height: 60 }} padding="md" data-app-surface="shell">
      <AppShell.Header>
        <AppHeader
          view={view}
          onNavigate={setView}
          onSignOut={() => void signOut()}
          accountLabel={user?.display_name ?? user?.email}
          skipHousehold={user?.skip_household ?? false}
        />
      </AppShell.Header>

      <AppShell.Main>
        <ViewBody view={view} />
      </AppShell.Main>

      <HouseholdSetupModal
        opened={promptHousehold}
        onClose={dismissHouseholdPrompt}
        firstRun
      />
    </AppShell>
  );
}
