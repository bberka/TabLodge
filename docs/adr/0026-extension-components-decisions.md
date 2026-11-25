# 26. Extension UI primitive decisions that were code comments (src/components/ui)

Status: accepted, 2026-11-25. Issue #442.

## Context

`apps/extension/src/components/ui` holds the Radix and Tailwind primitives the pages share. Its non-obvious decisions (focus rules, keyboard behavior, scrollbar and table layout) were comments. Comments are banned ([Code comments](../agents/comments.md)), so each decision lives here with the symbol that carries it. Pages that use these primitives are covered by [ADR 0017](0017-extension-app-decisions.md).

## Decisions

### Primitives

* **Context and dropdown menus share prop shapes.** The context-menu parts take the same props as the dropdown ones (`action-menu.tsx:contextKit`).
* **Closed menus cost nothing.** Their items mount only while open (`action-menu.tsx:MenuItems`).
* **Alert dialogs have no close button or outside dismissal.** The user answers with Cancel or the action; Escape still cancels (`alert-dialog.tsx:AlertDialogContent`).
* **A destructive confirmation opens on Cancel.** Initial focus follows DialogContent's rules (`alert-dialog.tsx:AlertDialogContent`).
* **Dialog content stays while it closes.** It stays populated during the close animation even after the caller clears its data (`dialog.tsx:useRetainedValue`).
* **Dialogs share one open state.** Dialog and AlertDialog share it, and the content freezes its children while closing (`dialog.tsx:DialogOpenContext`).
* **Dialogs share the open state with content.** (`dialog.tsx:Dialog`).
* **Focus returns to the opener.** What had focus when a dialog opened is remembered, and a confirmation opened from a dialog returns focus there (`dialog.tsx:returnFocus`).
* **Focus goes back to the opener.** A caller's `onCloseAutoFocus` that calls preventDefault keeps full control (`dialog.tsx:returnFocus`).
* **Nested dialogs return focus to their own first choice.** When the opener is gone or disabled (`dialog.tsx:returnFocus`).
* **Focus falls back to the last control used outside a dialog.** (`dialog.tsx:returnFocus`).
* **The close button never takes initial focus.** Focused, it shows its ring and tooltip, and Escape would close only the tooltip (`dialog.tsx:DialogCloseButton`).
* **Initial focus order is fixed.** An element marked `data-autofocus`, then the first form field, the primary action, else the container (`dialog.tsx:initialFocusTarget`).
* **Keyboard focus is told apart.** A focus right after a Tab press is keyboard focus; script or pointer focus is not (`dialog.tsx:lastTabPress`).
* **The close tooltip opens on hover and Tab only.** Other focus is default-prevented (`dialog.tsx:DialogCloseButton`).
* **One Escape always closes.** While the tooltip shows, Escape closes the dialog too (`dialog.tsx:DialogCloseButton`).
* **Uncontrolled dialogs never freeze.** Only a controlled dialog keeps children while closing (`dialog.tsx:DialogContent`).
* **A caller's open focus rule wins.** Its own `onOpenAutoFocus` that calls preventDefault keeps control (`dialog.tsx:DialogContent`).
* **The container takes focus without a ring.** It is focusable and has no visible focus ring (`dialog.tsx:DialogContent`).
* **The right padding clears the close button.** Long titles do not run under it (`dialog.tsx:DialogHeader`).
* **Actions sit right, primary last.** Cancel first, the primary action last; start content such as Back goes to the left edge (`dialog.tsx:DialogFooter`).
* **One drop marker for every drag.** A straight primary line with square ends and a dot at its start; the caller positions it in the gap (`drop-indicator.tsx:DropIndicator`).
* **Menus fit the space Radix reports.** They never grow past it; the ScrollArea inside shrinks and scrolls (`dropdown-menu.tsx:menuScrollClass`).
* **Radio choices use native radio inputs.** Arrow keys, form semantics and screen readers work without extra code (`radio-cards.tsx:RadioCard`).
* **Radix's table wrapper breaks truncation.** It lets long text push content wider than the viewport, so vertical-only areas keep it a block (`scroll-area.tsx:ScrollArea`).
* **The scrollbar reserves space once it shows.** Row content such as a checkmark never sits under the thumb (`scroll-area.tsx:reserveScrollbar`).
* **The Select viewport is the ScrollArea viewport.** The composition Radix documents, so long lists get the themed scrollbar and fit the window (`select.tsx:SelectContent`).
* **Read-only keeps the switch focusable.** It is announced (aria-readonly) but blocks toggling (`switch.tsx:Switch`).
* **Read-only looks like disabled.** It shares the faded look of `disabled` (`switch.tsx:Switch`).
