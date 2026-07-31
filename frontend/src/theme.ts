import { createTheme, MantineColorsTuple } from "@mantine/core";

/**
 * The logo's green, spread into the 10 steps Mantine needs. Two of the steps are
 * the mark's own colours rather than interpolations: shade 6 is `rgb(64,160,75)`
 * and shade 9 is `rgb(29,109,51)` — `--salamander-green` and
 * `--salamander-green-deep` in `index.css`, which have to move with them. The
 * rest are lightens and darkens along that line, which is what the `light` and
 * `outline` variants draw on.
 *
 * The third logo colour, the lime `#84bf44`, is a different hue (87° against
 * this ramp's 127°) — folding it in would bend the scale, so it stays its own
 * variable, `--salamander-green-light`.
 */
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
 * The brand green is registered as a *named* colour rather than as
 * `primaryColor`, deliberately: it is the accent — what marks the selected nav
 * item, the active cart, whatever the eye should land on — not the fill for
 * every button on the page. Components opt in with `color="salamander"`, or CSS
 * reaches for `--salamander-green`. If the product later wants green buttons
 * throughout, `primaryColor: "salamander"` is the one-line change.
 */
export const theme = createTheme({
  colors: { salamander },
  primaryColor: "dark",
  primaryShade: { light: 9, dark: 0 },
  autoContrast: true,
  defaultRadius: "md",
  // Loaded in `main.tsx` via @fontsource. The stack behind it is the fallback for
  // the moment before the file lands, not decoration — keep the two in step.
  fontFamily: "Montserrat, system-ui, Helvetica, Arial, sans-serif",
  headings: {
    fontFamily: "Montserrat, system-ui, Helvetica, Arial, sans-serif",
  },
});
