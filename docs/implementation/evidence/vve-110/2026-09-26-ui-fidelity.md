# UI fidelity pass, 2026-09-26

Automated Chrome (Playwright, `channel: chrome`) against the local production
backend and PostgreSQL with disposable fixture data. Desktop is 1440×900 with a
fine pointer; iPad is 768×1024 portrait with touch emulation. This is browser
evidence, not physical iPad or Apple Pencil confirmation.

`2026-09-19-browser-validation.md` and `browser-checks.json` record the earlier
candidate and stay as history; this file supersedes their layout findings.

## Fidelity contract

- Direction: analytical workbench (structured Soft UI). Depth is a hierarchy
  instrument: board chrome is raised, choice tracks and input wells are
  recessed, the active tool is pressed into the rail, and only the primary
  action ("=", "Dodaj wykres") is solid accent.
- Signature: the recessed tool well. The properties strip holds one well per
  concern and shows only what the active tool uses: pen, shape and line show
  colour and width ("Grubość"); text shows colour and size ("Rozmiar"); the
  eraser shows size only.
- One top-left light; one material for surfaces, inputs, ranges, colour
  swatches, the calculator keypad and the zoom control.
- Layers: one scale in `style.css` — board chrome (3000) < lesson panels (3100)
  < menus and popovers (3200) < artifact progress (3300) < toasts (5000) <
  modals (8000).
- Focus: 2 px blue outline, 2 px offset on every keyboard stop.
- Targets: at least 44×44 CSS px; menus clamp to a 12 px viewport margin.
- Motion: surfaces enter with opacity and a 4 px rise over 180 ms; press
  feedback is 120 ms; no `transition: all`; no hover transforms; hover styles
  apply only under `(hover: hover)`.

## Rendered state inventory

32 states (16 desktop, 16 iPad): Administrator login and list, Student entry,
Student board, Teacher dashboard, board default, pen, shapes menu, eraser,
text, settings menu, PDF export menu, calculator, function graph, physics graph,
coordinate-system menu. Every state: no horizontal overflow
(`scrollWidth == clientWidth`) and no console errors.

Corrected in this pass:

| Finding | Correction |
| --- | --- |
| Properties bar sat above the settings menu; "Cała tablica (1 strona)" was unreachable on iPad and panels were covered | Layer scale; menus now above chrome and panels |
| 360×225 wrapped properties bar; the width slider rendered as an empty white box; eraser and text showed irrelevant controls | Single-row recessed wells, tool-specific controls, material range and colour inputs |
| Toolbar collapse button half hidden behind the properties bar | 44 px target under the tool rail |
| Duplicate shape icons (Square ×2, Diamond ×3, Box ×2, Pyramid ×2) | One distinct glyph per shape (`ShapeIcon.vue`) |
| Two menu entries both labelled "PDF" | "Importuj PDF" and "Eksportuj PDF" |
| Pastel calculator keys and full-width colour bars outside the material family | Raised keys in a recessed keypad; round colour swatch with its hex value |
| Calculator opened over the presence pill | Initial position clears the top band |
| Panel close (26 px), presence minimise (30 px) and toolbar collapse (36 px) below 44 px | All 44 px |
| Hidden paste field reachable by Tab outside the viewport | Removed from tab order and labelled |

A scan of every visible button, input, select and link in the pen, shapes,
settings and calculator states found no target below 44×44 on desktop or iPad.

## Focus and contrast

- Keyboard walk from the board: 44 focus stops, all with
  `solid 2px rgb(37, 99, 235)` and a 2 px offset, all inside the viewport.
- Token contrast (WCAG ratio): primary text on raised surface 15.18,
  secondary text on raised 6.44 and on recessed 6.03, tertiary text on raised
  4.05 (used only for placeholders and metadata), accent `#2563eb` on raised
  4.39 (icons and 20 px operator keys only), darker accent `#1d4ed8` on raised
  5.70 (small accent text changed in this pass: selected segments, memory keys), white on
  accent 5.17.
- Enlarged text: `enlarged-text-contrast.png` from the earlier pass still
  applies; the new properties strip wraps within `100vw - 100px` instead of
  overflowing.

## Motion verdict and interruption

- No computed `transition-property: all` with a non-zero duration remains on
  the board (desktop and iPad scans).
- Removed hover transforms: tool buttons, option pills, colour swatches, gear,
  presence toggle, toolbar expand, collaborator avatars, and resize handles.
- Interrupted collapse: collapsing the toolbar and reversing it 60 ms later
  settles visible (`opacity: 1`, interactive).
- Interrupted popover: dismissing the shapes menu 40 ms into its entrance and
  reopening it settles at `opacity: 1`, `transform: none`.
- Verdict: motion explains state change only (surface entry, press); it is
  short, interruptible and transform/opacity-only. Accepted.

## Preference states

iPad with `prefers-reduced-motion: reduce`, `prefers-reduced-transparency:
reduce` and `prefers-contrast: more` emulated together: transitions and
animations collapse to 1 ms, no backdrop filter, panel borders switch to the
high-contrast token `rgb(100, 116, 139)`
(`2026-09-26-ipad-reduced-preferences.png`).

## Evidence files

- `2026-09-26-{desktop,ipad}-{07-pen,08-shapes,09-eraser,12-pdf-menu,13-calculator,15-physics}.jpg`:
  matched desktop and iPad states.
- `2026-09-26-desktop-focus-ring.png`: keyboard focus on the active tool.
- `2026-09-26-ipad-reduced-preferences.png`: combined preference state.

## Bounded deviations

- Tertiary text (4.05:1) and the base accent (4.39:1) sit below 4.5:1 on the
  raised surface; they are reserved for placeholders, metadata, icons and
  large text, where 3:1 applies.
- Physical iPad, Apple Pencil and graphics-tablet behaviour remains Kordian's
  hardware check.
