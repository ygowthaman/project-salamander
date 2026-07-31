import { createTheme } from "@mantine/core";

/**
 * The app's single source of visual truth. The app is locked to dark —
 * `forceColorScheme="dark"` in `main.tsx` — so dark is the case to get right.
 *
 * `primaryColor: "dark"` keeps the monochrome look the login screen already had,
 * but the shade has to invert per scheme or it disappears: Mantine's default
 * primary shade would paint a near-black button onto a near-black page. Shade 0
 * is the lightest step of the `dark` palette, so buttons read as near-white on
 * the dark background, and `autoContrast` flips their label to dark text.
 *
 * Swapping `primaryColor` to a real accent ("teal", "orange", …) is a one-line
 * change if the product picks a brand colour later.
 */
export const theme = createTheme({
  primaryColor: "dark",
  primaryShade: { light: 9, dark: 0 },
  autoContrast: true,
  defaultRadius: "md",
  fontFamily: "Inter, system-ui, Helvetica, Arial, sans-serif",
  headings: { fontFamily: "Inter, system-ui, Helvetica, Arial, sans-serif" },
});
