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
 * There is one ramp, so roles split by *step* rather than by hue:
 *
 * - `primaryColor: "salamander"` — every button and interactive control. Shade 6
 *   is the mark's own green and the one step that holds against the near-black
 *   page; `autoContrast` puts dark text on the fill, since white on `#40a04b`
 *   lands near 3.4:1 and would miss 4.5:1.
 * - The lime `--salamander-green-light` — the accent, reached for deliberately
 *   in CSS on nav items and headers. It is never a fill.
 *
 * Because "you can click this" and "you are here" now share a hue, neither may
 * lean on colour alone: the accent is always paired with a second signal (the
 * active nav item carries a rule under it, headers carry their weight and size).
 */
export const theme = createTheme({
  colors: { salamander },
  primaryColor: "salamander",
  primaryShade: 6,
  autoContrast: true,
  defaultRadius: "md",
  // Loaded in `main.tsx` via @fontsource. The stack behind it is the fallback for
  // the moment before the file lands, not decoration — keep the two in step.
  fontFamily: "Montserrat, system-ui, Helvetica, Arial, sans-serif",
  headings: {
    fontFamily: "Montserrat, system-ui, Helvetica, Arial, sans-serif",
  },
});
