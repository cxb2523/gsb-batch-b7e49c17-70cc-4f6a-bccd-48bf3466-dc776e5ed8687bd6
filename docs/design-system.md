# Website design system

The live reference is `#/design-system`, linked from the footer. It uses the same controls as the site, so a change is visible there immediately. This system belongs to the studio website. The published library keeps its separate `--ik-*` tokens and public API.

## Direction

A quiet workshop for interactive drawings: clear type, generous space, neutral surfaces, precise edges. The drawings supply the personality. Copy says what someone can do in ordinary language.

The visual reference is [shwn.design](https://shwn.design): thin highlights, restrained corners, soft viewport fades, and a folder that responds when opened. The implementation is original React and CSS. It does not use shadcn, Tailwind, or a third-party animation runtime. Native popovers provide outside-click dismissal, Escape handling and trigger relationships; see [MDN's popover guide](https://developer.mozilla.org/en-US/docs/Web/API/Popover_API/Using).

The UI/UX skill's minimal, spacious direction fits this project. Its generic dark-blue palette, gold accent and Poppins recommendation do not match the existing artwork or reference; they were not applied. Motion is restrained: the interactive examples already move.

## Sources of truth

| File | Owns |
| --- | --- |
| `examples/demo/src/styles/tokens.css` | Colors, spacing, type sizes, radii, shadows, timing, page width |
| `examples/demo/src/styles/base.css` | Resets, page shell, typography, landing layouts, safe areas and edge fades |
| `examples/demo/src/styles/controls.css` | Buttons, command copying, focus, disabled states, surfaces, navigation picker |
| `examples/demo/src/styles/site.css` | Gallery, documentation, filters, sound list and studio layouts |
| `examples/demo/src/styles/design-system.css` | Layout of the live reference only |
| `examples/demo/src/app/navigation-picker.tsx` | A reusable grouped navigation popover made from real links |
| `examples/demo/src/app/folder.tsx` | A reusable native disclosure with a small folder animation |

## Tokens and rules

| Foundation | Rule |
| --- | --- |
| Color | `--bg` canvas, `--card` inset groups, `--surface` raised controls, `--fg` primary text, `--muted` secondary text, `--line` separators |
| Corners | Controls 8 px, cards 12 px, grouped panels 16 px. Inner menu rows use 6 px to fit inside their 12 px container. Circles are reserved for dots. |
| Depth | `--control-shadow` for controls; `--bezel` for bounded interactive surfaces. No blur behind text. |
| Type | Existing neutral sans stack; `--font-mono` for code. Body 15 px, supporting text 13 px, captions 12 px, lede 17 px. Page titles scale from 34 to 52 px. |
| Space | `--space-1` through `--space-11`: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 96 px. Use 8–12 within controls, 20–32 inside cards, 48–96 between sections. |
| Layout | 1120 px maximum width. Gutters grow from 20 to 40 px; 16 px at the smallest width. Grid children that contain code use `minmax(0, 1fr)`. |
| Touch | Main controls and mobile links have a minimum 44 px target. No action depends on hover. |
| Focus | 2 px high-contrast outline, 4 px offset. Menu links use an inset outline to avoid clipping. |
| Selection | Surface, border and dot/checkmark together. Reserve the marker's width so selecting does not shift labels. |
| Timing | Press 140 ms, color changes 160 ms, menu/folder entry 200 ms. Ease-out: `cubic-bezier(0.23, 1, 0.32, 1)`. |
| Motion | Transform and opacity only for shell interactions. Keyboard focus bypasses decorative transitions. Reduced motion removes them. |
| Safe areas | `viewport-fit=cover`, left/right safe insets on the shell, top inset above the header, bottom inset in the footer and floating menu fallback. |
| Blur | Shallow 3 px viewport fades with pointer events disabled. Reduced transparency and print remove them. |

Secondary text contrast is 4.53:1 on the light inset surface, 4.90:1 on the light canvas, and at least 5.10:1 on the dark raised surface. Primary action contrast exceeds 15:1 in both themes. These are palette calculations, not a claim that every illustration has been contrast-audited.

## Add or change a control

Use a link for navigation and a button for an action. Reuse `.button`, `.button-secondary`, `.pill`, `CopyCommand`, `NavigationPicker` or `Folder` before adding another implementation. Pick a semantic color and existing spacing/radius token. Keep application state in React; let native details and popover own their disclosure behavior.

The picker is navigation, not a form select. Its items are links and Tab traverses them; it does not claim listbox or ARIA menu semantics. Escape closes it. CSS anchor positioning attaches it to its trigger; browsers without that CSS feature get a safe-area-aware floating panel.

Do not put these website tokens into `src/styles.css`. That would change the library's consumer-facing styles and require the library release process.

## Design review

| Before | After |
| --- | --- |
| Mobile documentation used a browser-native select | A shared menu with grouped links, current-page check, focus and light dismissal |
| Most spaces and control rules lived together in one stylesheet | Shared token and control files, documented roles, live specimens |
| Long industry matrix displayed every brief at once | Native folders reveal one group on demand; existing starter commands remain available |
| Desktop navigation rules affected the component sidebar | Site navigation and documentation navigation have separate layout rules |
| Dense gallery captions and property tables | Wider gaps, comfortable captions, keyboard-scrollable table regions |
| Content reached the viewport edges | Responsive gutters, safe-area padding and shallow noninteractive fades |
| Page navigation could retain the previous page's scroll | Page changes reset scroll; sound deep links keep their target scroll |

## Validation

Run `npm run check` and `npm run demo:build`. Review light and dark at 320, 390, 820 and 1280 px. Check every route for document overflow, then try the controls: picker navigation and dismissal, filter selection and empty results, folder disclosure, command copying, theme, sound and a figure press.

Property tables and code blocks may scroll internally; the document must not scroll sideways. Check reduced-motion and safe-area CSS when changing the shell. Desktop viewport resizing does not replace physical-device testing with a notch, browser chrome or a screen reader.

Verified on 6 October 2026: the full check suite passed (106 tests, types, lint, packaging and library size budgets), and the studio production build passed. Browser checks covered all 53 figure detail pages and 11 component pages at 320 and 1280 px, plus eight representative routes at four widths in both themes: 192 layout checks with no document overflow and no runtime console errors during the final sweep. Picker selection, Tab order, Escape and outside-click dismissal, filter empty/reset states, keyboard folder opening, starter-command copying, sound deep links and playback feedback, figure presses, and home scroll reset were exercised separately. The studio still reports its existing large-bundle warning; the latest main chunk is about 677 kB before compression.
