import { Container, Stack, Tabs, Text, Title } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconHome, IconLock, IconUser } from "@tabler/icons-react";
import { useState } from "react";
import { HouseholdSettings } from "./HouseholdSettings";
import { SettingsPlaceholder } from "./SettingsPlaceholder";

type Section = "profile" | "authentication" | "household";

/**
 * Settings, reached from the header menu.
 *
 * The sections are a vertical nav on anything wide enough for one and a row of
 * tabs below that: a 200px rail beside a form leaves neither enough room on a
 * phone. There is no router yet, so which section is open is local state — swap
 * it for a route param when one lands, since these are the screens people link
 * each other to.
 *
 * Profile and Authentication are stubs. Household is the one that is built.
 */
export function SettingsPage() {
  const [section, setSection] = useState<Section>("profile");
  const narrow = useMediaQuery("(max-width: 48em)");

  return (
    <Container size="lg" py="md">
      <Stack gap="lg">
        <div>
          <Title order={2}>Settings</Title>
          <Text size="sm" c="dimmed">
            Your account, how you sign in, and the household your data belongs to.
          </Text>
        </div>

        <Tabs
          value={section}
          onChange={(value) => setSection((value ?? "profile") as Section)}
          orientation={narrow ? "horizontal" : "vertical"}
          variant="pills"
          keepMounted={false}
        >
          <Tabs.List w={narrow ? undefined : 200} mb={narrow ? "md" : undefined}>
            <Tabs.Tab value="profile" leftSection={<IconUser size={16} stroke={1.6} />}>
              Profile
            </Tabs.Tab>
            <Tabs.Tab value="authentication" leftSection={<IconLock size={16} stroke={1.6} />}>
              Authentication
            </Tabs.Tab>
            <Tabs.Tab value="household" leftSection={<IconHome size={16} stroke={1.6} />}>
              Household
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="profile" pl={narrow ? undefined : "xl"}>
            <SettingsPlaceholder
              title="Profile"
              body="Your display name, email address and avatar will be editable here."
            />
          </Tabs.Panel>

          <Tabs.Panel value="authentication" pl={narrow ? undefined : "xl"}>
            <SettingsPlaceholder
              title="Authentication"
              body="Setting or changing your password, linking a Google account, and signing out of other devices will live here."
            />
          </Tabs.Panel>

          <Tabs.Panel value="household" pl={narrow ? undefined : "xl"}>
            <HouseholdSettings />
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </Container>
  );
}
