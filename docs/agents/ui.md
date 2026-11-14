# UI rules

Rules for every change to extension pages (`apps/extension/src`). Read the whole file before writing UI, and check it again before the pull request. The website has its own rules in [Site](site.md); the Android app's in [Mobile](mobile.md).

## Components and styling

- Use Tailwind theme tokens such as `bg-background` and `text-muted-foreground` rather than raw colors. Check both light and dark themes.
- Tailwind 4 keeps real cascade layers, and Chrome adds an unlayered `body` rule to extension pages. A style that must beat it, like the `body` font in `apps/extension/styles/extension-app.css`, goes outside `@layer`. The theme is configured in that file (`@theme`), and there is no `tailwind.config` file. The PostCSS plugin scans only `apps/extension` (see `postcss.config.cjs` there), and `@source not` lines skip its build output and tests.
- Build controls from the local Radix components in `apps/extension/src/components/ui/`, exposed through `apps/extension/src/shared/ui.tsx`. To add a primitive, run `pnpm dlx shadcn@latest add <component>` and review the generated code.
- Use icons from `lucide-react`. Controls must work with a keyboard, have visible focus, and have labels. Pair icon buttons with `aria-label` and `IconTooltip`. Announce feedback with an appropriate status or alert role.
- External links should use `target="_blank" rel="noopener noreferrer"`.
- Read the display name from `PROJECT.name` in pages or `APP_NAME` in the worker. Both use the manifest's `short_name`. Changes to storage keys, export format identifiers, drag MIME types, or context menu IDs need a migration.

## Accessibility

TabLodge is used by keyboard and with screen readers, so every UI change meets [WCAG 2.2 AA](https://www.w3.org/TR/WCAG22/) for what it touches. Check these before you write the UI, not after:

- **Everything works from the keyboard.** Anything done by dragging, hovering, or right clicking has a keyboard alternative. Reordering sessions, bookmark columns, and bookmarks is available as **Move up**, **Move down**, **Move left**, and **Move right** in their menus. Keep drag as well, and do not replace it.
- **Use the native element or the Radix primitive.** A `button` for actions, an `a` for navigation, Radix for dialogs, menus, selects, and tooltips. If you build a custom control, follow its [WAI-ARIA pattern](https://www.w3.org/WAI/ARIA/apg/patterns/): roles, states, and keys. A radio group, for example, has one tab stop and uses arrow keys (see `apps/extension/src/shared/radio-keys.ts`).
- **Name and state.** Icon only buttons have an `aria-label` that includes what they act on. Toggles expose `aria-expanded`, `aria-pressed`, `aria-checked`, or `aria-current`. Decorative icons and duplicate images are `aria-hidden`.
- **Focus.** Focus is visible, follows reading order, and never ends up on the page body. After an action that removes or moves the focused element, put focus somewhere sensible: `apps/extension/src/shared/focus-rescue.ts` covers removal, and `focusAfterMove` in `apps/extension/src/app/reorder.ts` covers moving. Dialogs return focus to what opened them without extra code (the shared dialog components do it, including for a dialog opened from a menu item), and menus do the same.
- **Announce results.** Success, errors, and changes with no visible focus move go through `showStatus` so a screen reader hears them. A search says how many results it found (`status` on `ExpandingSearch`, or a `role="status"` region next to the field). Do not rely on color, position, or animation alone.
- **Targets and contrast.** Interactive targets are at least 24 by 24 CSS pixels, or have enough spacing. Text and controls meet contrast in both themes. Respect reduced motion.
- **Pages with the shared header** get the skip link from `AppHeader`. A new page with its own navigation adds one.

Run `vp run build` and then `vp run a11y`. It runs axe-core on every extension page in both themes and exercises the keyboard workflows above. Add a check to `apps/extension/scripts/a11y-check.ts` when you add a workflow that needs the keyboard. Automated checks cannot judge reading order, announcements, or whether a workflow makes sense, so use available browser accessibility or screen reader tools to inspect the affected workflow. Manual screen reader testing is not required. In the pull request, report the tools used or that none were available, what you tested, and any gaps.

