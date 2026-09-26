# VVE-110 UI fidelity contract

## Direction and signature

VVE is an analytical collaborative workbench. Its UI blends the structured density of a dashboard with a restrained tactile material system around a whiteboard that remains the visual and functional centre. The signature is the recessed tool well: controls sit in shallow raised or pressed surfaces that explain hierarchy without covering the working area.

## Geometry

- Desktop reference state: 1440 x 900, full-height whiteboard, left tool well, top utility control, participant status in the opposite corner, and lesson panels anchored inside the board safe area.
- Portrait reference state: 768 x 1024, no horizontal overflow. The tool well and utility menu wrap or reposition inside the viewport; PDF choices remain reachable without hover.
- Utility controls keep at least a 44 x 44 CSS pixel pointer target. Menus stay inside a 12 px viewport margin and may scroll vertically.
- The whiteboard keeps the largest uninterrupted surface. Floating controls use soft elevation and a light boundary rather than opaque full-screen chrome.
- Dashboard and entry surfaces use the same surface, light-source, radius, focus, and press tokens while retaining their task-specific density.

## Typography

- Use the platform system stack with optical sizing and legible Polish labels.
- Keep headings compact and high contrast; use uppercase eyebrow labels only for wayfinding.
- Body and control text must wrap when enlarged. No fixed-height control may clip a label.

## Materials

- One top-left virtual light: raised surfaces use a light upper-left highlight and a cool lower-right shadow; pressed wells reverse that relationship.
- The board surface is quiet and bright. Tool and status surfaces are slightly darker than the board so depth communicates hierarchy.
- Blur is optional polish, never required for contrast. Reduced transparency uses opaque surfaces and defined borders.
- Focus is a blue 2 px outline with a 2 px offset, visible on raised and pressed surfaces.

## Motion

- Menu and popover entry: trigger-origin `opacity` plus `translateY` from 4 px to 0, 150–220 ms, ease-out. No scale from zero and no hover-only required state.
- Press feedback: transform/box-shadow only, 100–160 ms. It starts on pointer-down and remains understandable with motion reduced.
- Opening, closing, and Escape are interruptible. A close returns focus to the trigger.
- Reduced motion removes travel, spin, and looping decoration, keeping a short opacity/color transition and all state feedback.

## Interaction

- The settings trigger is always rendered and keyboard focusable. It exposes `aria-expanded` and controls the utility menu.
- PDF import and both PDF export modes are explicit buttons. Paged export opens from a click/tap toggle with `aria-haspopup="menu"`; hover may enhance desktop use but never owns reachability.
- Enter/Space activates controls, Arrow/Home/End navigate roving menu items where applicable, and Escape closes the deepest open surface before the parent menu and restores focus.
- Touch and keyboard use the same command path as pointer input. Menu and panel surfaces do not depend on mouseenter.
- Popovers close on outside click and retain a visible focus ring. A control never opens off-screen at the required viewports.

## Accessibility and variants

- Default, keyboard focus, pressed, disabled, loading, error, and completion states are checked at 1440 x 900 and 768 x 1024.
- `prefers-reduced-motion: reduce` removes large movement, spinner motion, and decorative rotation while preserving state changes.
- `prefers-reduced-transparency: reduce` removes backdrop blur and raises surface opacity. `prefers-contrast: more` adds stronger boundaries and foreground separation.
- Enlarged text must reflow dashboard cards, entry states, toolbar labels, and utility menus without clipping or horizontal overflow.
- Automated browser evidence is labelled mouse/touch emulation. Physical iPad and Apple Pencil remain a separate hardware gate.

## Evidence inventory

- Source-native unit tests cover explicit menu reachability, PDF export mode toggling, Escape/focus restoration, and the material/accessibility token contract.
- In-app Browser checks cover 1440 x 900 and 768 x 1024, normal and reduced motion, reduced transparency, enlarged layout, menu/panel reachability, and gesture interruption of a board interaction.
- Remaining bounded deviations are physical Apple Pencil feel, real hardware text scaling, and deployment-specific browser compositor differences when the in-app Browser cannot expose them.
