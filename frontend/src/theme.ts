import { createTheme, MantineColorsTuple } from "@mantine/core";

// Shades 6 and 9 are the logo's own greens, duplicated as --salamander-green and
// --salamander-green-deep in index.css; change one and change the other.
const salamander: MantineColorsTuple = [
  "#eef8f0",
  "#dcefe0",
  "#b6ddbe",
  "#8ecb9a",
  "#6cbb7c",
  "#54b167",
  "#40a04b",
  "#348e42",
  "#297d3a",
  "#1d6d33",
];

export const theme = createTheme({
  colors: { salamander },
  primaryColor: "salamander",
  primaryShade: 6,
  autoContrast: true,
  defaultRadius: "md",
  fontFamily: "Montserrat, system-ui, Helvetica, Arial, sans-serif",
  headings: {
    fontFamily: "Montserrat, system-ui, Helvetica, Arial, sans-serif",
  },
});
