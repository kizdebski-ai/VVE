# Integrated Browser verification, 2026-09-19

These checks used the Codex in-app Browser against the local production backend and PostgreSQL. The boards and accounts contain disposable test data. This is software/browser evidence, not physical Apple Pencil confirmation.

| Workflow | Observed result |
| --- | --- |
| Administrator and Teacher lifecycle | Create a disposable Teacher; retrieve and rotate its access link; old link denied; new login retains the same Managed Board and its link; unrelated Teacher link unchanged. Deactivation denies the new login. |
| Managed Board lifecycle | Create a board; rotate its Student link; old invitation denied without a Teacher cookie; new invitation shows the immutable public identity. End Board Access disconnects the Student, shows read-only state and denies the next invitation entry. |
| Student without Teacher | Student joins an otherwise empty board, draws, uses undo/redo and reloads. Student has no whole-board clear control. |
| Collaboration | Teacher and Student edits propagate. Participant undo preserves the other participant's stroke. PNG, JPEG and WebP are visible in the Student view, including a moved/resized WebP. |
| Input and tools | Raw pointer-up endpoint preserved. Polish/Greek text commits from the inline editor; near-edge editor stays within the viewport without scrolling the board. Calculator arithmetic and scientific functions work; graph validation, disconnected 1/x branches, physics data, coordinate systems and all visible shape choices were exercised. |
| Partial erasing and transforms | Partial erasing leaves two visible stroke segments; undo, redo, a second participant and reload preserve the result. Whole-object delete removes the selected segment. A pen rotated 90 degrees is erased at its visible position. Rectangle rotation preserves its center; resizing its rotated corner preserves the opposite corner. Line endpoints, arrows, color and undo were exercised. |
| PDF and images | Two-page fixture import survives reload. PNG paste, JPEG upload and WebP upload work. Image resize, undo and redo preserve the expected bounds. |
| Actual PDF export | `browser-export-offscreen-images.pdf` is a 76,740-byte, two-page A4 PDF produced by the real menu action after a fresh board reload. The WebP was outside the viewport and had not been visited since reload. Poppler rendering confirms all three images, imported PDF pages, plots, text, strokes and distant shapes in the output. Bytes were observed at the browser's Blob delivery boundary; the OS download shelf is not claimed. |
| Restart | Both clients show the restart/read-only message. A drawing attempt is refused. After backend restart the read-only status clears, both clients reconnect and the visible lesson contents remain present. |
| Layout | 1440×900 desktop and 768×1024 portrait checked. At an effective 720×450 CSS viewport the vertical toolbar scrolls within its bounds, and scientific calculator contents remain reachable. Administrator/Teacher controls now measure at least 44×44 CSS pixels, with no portrait horizontal overflow. |
| Preferences | Reduced motion and reduced transparency were exercised; the material no longer depends on backdrop blur and content does not overflow. Temporary emulation overrides are removed after verification. |
| Input measurement | In-app Browser mouse input at 768×1024 recorded 69 input-to-paint samples, p95 12.74 ms, with no console warnings/errors in that pass. This is a local software sample, not representative physical Pencil/tablet certification. |

## Evidence files

- `compact-desktop-calculator.png`: compact scientific calculator and reachable controls.
- `student-entry-identity.png`: public Teacher identity on Student invitation.
- `student-images-synchronized.png`: Student view with the three image formats after collaboration and transformation.
- `readonly-during-restart.png`: visible restart/read-only state.
- `browser-export-offscreen-images.pdf`: real generated PDF, independently rendered and inspected.
- `rotation-eraser-portrait.png`: rotated/resized rectangle, lines and partially erased rotated pen.
- `compact-eraser-zoom.png`: mode and zoom controls remain separate at 720×450; their measured vertical gap is 12 CSS pixels, also confirmed at 768×1024.

## Limits and follow-up

Partial erasing, the rotation-origin mismatch, small transform hit targets and overlapping eraser/zoom controls were found and corrected during this pass. The in-app Browser does not expose native multi-touch dispatch in this environment. Pointer cancellation, multi-touch transitions and pressure are covered by the software event tests; physical iPad/Apple Pencil and graphics-tablet lesson confirmation remains Kordian's release check. Railway deployment is outside this local PR verification.
