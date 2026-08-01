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
 * The secondary ramp — Mantine's `orange` steps, pinned here rather than left
 * implicit so the scale is visible next to `salamander` and `index.css` has
 * something to document its variables against.
 *
 * It is the *accent*, not a fill: it names the view you are on (active nav item
 * and its underline) and it sets section headers. Nothing clickable is painted
 * with it — that is the primary's job — which is what keeps the two readable as
 * different things. Shade 4 is the accent proper (`--salamander-orange-light`),
 * shade 6 the hover (`--salamander-orange`), shade 8 the far end
 * (`--salamander-orange-deep`) — change one of those three, change its twin in
 * `index.css`.
 */
const orange: MantineColorsTuple = [
  "#fff4e6",
  "#ffe8cc",
  "#ffd8a8",
  "#ffc078",
  "#ffa94d",
  "#ff922b",
  "#fd7e14",
  "#f76707",
  "#e8590c",
  "#d9480f",
];

/**
 * The app's single source of visual truth. The app is locked to dark —
 * `forceColorScheme="dark"` in `main.tsx` — so dark is the case to get right.
 *
 * The two ramps split by *role*, not by importance:
 *
 * - `primaryColor: "salamander"` — every button and interactive control. Shade 6
 *   is the mark's own green and the one step that holds against the near-black
 *   page; `autoContrast` puts dark text on the fill, since white on `#40a04b`
 *   lands near 3.4:1 and would miss 4.5:1.
 * - `orange` — the accent, reached for deliberately (`color="orange"`, or
 *   `--salamander-orange-light` in CSS) on nav items and headers.
 *
 * Keeping fills green and accents orange means "you can click this" and "you are
 * here" never have to be told apart by hue alone.
 */
export const theme = createTheme({
  colors: { salamander, orange },
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
