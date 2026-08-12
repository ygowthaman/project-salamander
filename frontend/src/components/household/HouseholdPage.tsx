import { Container, Tabs } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconCategory } from "@tabler/icons-react";
import { useState } from "react";
import { CategoriesSection } from "../categories/CategoriesSection";

type Section = "categories";

export function HouseholdPage() {
  const [section, setSection] = useState<Section>("categories");
  const narrow = useMediaQuery("(max-width: 48em)");

  return (
    <Container size="lg" py="md">
      <Tabs
        value={section}
        onChange={(value) => setSection((value ?? "categories") as Section)}
        orientation={narrow ? "horizontal" : "vertical"}
        variant="pills"
        keepMounted={false}
      >
        <Tabs.List w={narrow ? undefined : 200} mb={narrow ? "md" : undefined}>
          <Tabs.Tab value="categories" leftSection={<IconCategory size={16} stroke={1.6} />}>
            Categories
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="categories" pl={narrow ? undefined : "xl"}>
          <CategoriesSection />
        </Tabs.Panel>
      </Tabs>
    </Container>
  );
}
