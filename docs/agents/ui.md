# UI rules

Rules for every change to extension pages (`apps/extension/src`). Read whole file before writing UI, check again before pull request. Website has own rules in [Site](site.md); Android app's in [Mobile](mobile.md).

## Components and styling

- Use Tailwind theme tokens like `bg-background` and `text-muted-foreground`, not raw colors. Check light and dark themes.
- Tailwind 4 keeps real cascade layers, Chrome adds unlayered `body` rule to extension pages. Style that must beat it, like `body` font in `apps/extension/styles/extension-app.css`, goes outside `@layer`. Theme configured in that file (`@theme`), no `tailwind.config` file. PostCSS plugin scans only `apps/extension` (see `postcss.config.cjs` there), `@source not` lines skip build output and tests.
- Build controls from local Radix components in `apps/extension/src/components/ui/`, exposed through `apps/extension/src/shared/ui.tsx`. To add primitive, run `pnpm dlx shadcn@latest add <component>` and review generated code.
- Scrolling lists, menus, selects use `ScrollArea` or `SelectContent`, never bare `overflow-y-auto` box inside popup. They reserve gutter for scrollbar (`reserveScrollbar`), so checkmark or right aligned control never covered.
- Anything clickable shows pointer cursor. `extension-app.css` sets it for buttons, links, `summary`, ARIA roles for menu items, options, tabs, switches, checkboxes, radios; never put `cursor-default` on component, utility beats that rule. `div`, `span`, `li` with `onClick` needs `cursor-pointer`. `tests/pointer-cursor-rule.test.ts` enforces all three.
- Use icons from `lucide-react`. Controls must work with keyboard, have visible focus, have labels. Pair icon buttons with `aria-label` and `IconTooltip`. Announce feedback with appropriate status or alert role.
- Tips, hints, help text sit behind small help button that opens popover or sheet, full text in Help. Page shows none permanently, including on empty search.
- External links use `target="_blank" rel="noopener noreferrer"`.
- Read display name from `PROJECT.name` in pages or `APP_NAME` in worker. Both use manifest's `short_name`. Changes to storage keys, export format identifiers, drag MIME types, or context menu IDs need migration.

## Destructive actions

Action that deletes, removes, resets, disconnects, or replaces something:

- **Settings asks first**, including dialogs it opens: `ConfirmationDialog` that names what is lost, where Cancel changes nothing. Keep any Undo toast after it.
- **Library views act at once** (dashboard, board, new tab, side panel, popup, palette) and offer **Undo** (`offerTrashUndo`, `offerUndo`, or `showStatus` action). No confirmation; shared Snapshots and Trash dialogs ask only with `confirmDestructive`, which Settings sets.
- **Exempt:** resetting one setting, editing list picker, switch that turns back on same way, password form, dialog whose review step already names the mode (Import).

## Accessibility

TabLodge used by keyboard and with screen readers, so every UI change meets [WCAG 2.2 AA](https://www.w3.org/TR/WCAG22/) for what it touches. Check these before writing UI, not after:

- **Everything works from keyboard.** Anything done by dragging, hovering, right clicking needs keyboard alternative. Reordering sessions, bookmark columns, bookmarks available as **Move up**, **Move down**, **Move left**, **Move right** in their menus. Column in Focus view's vertical list says Move up and Move down. Keep drag as well, do not replace it.
- **Use native element or Radix primitive.** `button` for actions, `a` for navigation, Radix for dialogs, menus, selects, tooltips. If building custom control, follow its [WAI-ARIA pattern](https://www.w3.org/WAI/ARIA/apg/patterns/): roles, states, keys. Radio group, for example, has one tab stop and uses arrow keys (see `apps/extension/src/shared/radio-keys.ts`).
- **Name and state.** Icon only buttons have `aria-label` that includes what they act on. Toggles expose `aria-expanded`, `aria-pressed`, `aria-checked`, or `aria-current`. Decorative icons and duplicate images are `aria-hidden`.
- **Focus.** Focus visible, follows reading order, never ends up on page body. After action that removes or moves focused element, put focus somewhere sensible: `apps/extension/src/shared/focus-rescue.ts` covers removal, `focusAfterMove` in `apps/extension/src/app/reorder.ts` covers moving. Dialogs return focus to what opened them without extra code (shared dialog components do it, including for dialog opened from menu item), menus do same.
- **Announce results.** Success, errors, changes with no visible focus move go through `showStatus` so screen reader hears them. Search says how many results found (`status` on `ExpandingSearch`, or `role="status"` region next to field). Do not rely on color, position, or animation alone.
- **Targets and contrast.** Interactive targets at least 24 by 24 CSS pixels, or have enough spacing. Text and controls meet contrast in both themes. Respect reduced motion.
- **Pages with shared header** get skip link from `AppHeader`. New page with own navigation adds one.

Run `vp run build` then `vp run check:a11y`. It runs axe-core on every extension page in both themes and exercises keyboard workflows above. Add check to `apps/extension/scripts/a11y/` when you add workflow that needs keyboard. Automated checks cannot judge reading order, announcements, or whether workflow makes sense, so use available browser accessibility or screen reader tools to inspect affected workflow. Manual screen reader testing not required. In pull request, report tools used or that none were available, what you tested, any gaps.
