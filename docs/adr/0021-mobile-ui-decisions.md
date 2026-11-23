# 21. Android interface decisions that were code comments

Status: accepted, 2026-11-23. Issue #442.

## Context

`apps/mobile/src/ui` carried its non-obvious decisions as comments. Comments are banned ([Code comments](../agents/comments.md)), so each decision lives here with the symbol that carries it. The look rules for the whole app are in [UI](../agents/ui.md), and the Android app's own rules are in [Android app](../agents/mobile.md). The area's other decisions are in [ADR 20](0020-mobile-decisions.md), [ADR 18](0018-mobile-private-decisions.md) and [ADR 19](0019-mobile-settings-decisions.md).

## Decisions

### Touch targets and sizes

* **Touch targets are at least 48 dp.** `src/ui/theme.ts:TARGET`. Android asks for it. A 40 dp chip (`widgets.tsx:Chips`) and a 36 dp segment (`widgets.tsx`, the segmented control) get padding to reach 48.
* **The small tab bar keeps a 52 dp target.** `src/ui/tab-bar.tsx:PILL_HEIGHT` and `COMPACT_HEIGHT`. Its icons grow a little to fill the room its labels leave.
* **One size for every round button.** `src/ui/floating-actions.tsx:SIZE`. The add, search and menu buttons share it, so they read as one set.
* **The round search button is as tall as the floating bar.** `tab-bar.tsx:floating`. It sits at the screen's right edge, and the bar leaves room for it on the right.
* **A list keeps room at its end for the round buttons.** `floating-actions.tsx:ROOM_FOR_BUTTONS`. The room is the bar's height plus the gap, so the last row is never hidden.

### Tab bar

* **The docked bar is the same tall bar in both looks.** `tab-bar.tsx:DOCKED_HEIGHT`. The iOS bar is too short for the highlighted pill, so the docked bar is taller on iOS as well.
* **A floating bar shrinks without moving the room the screens leave.** `tab-bar.tsx:floating`. Lists do not jump when it changes size.
* **A floating bar steps aside while searching.** `tab-bar.tsx`, the `searching` state. The search bar takes its place.
* **The small bar hides tab names.** `tab-bar.tsx`, the per-tab label value. A small bar has no room for names.
* **The small bar moves left just enough to clear the search button.** `tab-bar.tsx:smallLeft`. A full bar starts at the screen's left margin.
* **Only the floating bar is glass.** `tab-bar.tsx`, the glass branch. A docked bar is an edge of the screen and stays solid.
* **The shrink and the highlight run on the JS thread.** `tab-bar.tsx:shrink` and `slide`. Their values are layout, so the native driver cannot run them.
* **A keyboard that closed unnoticed does not keep the bar away.** `tab-bar.tsx`, the keyboard check against the window.

### Search

* **Only a screen that has a search offers one to the docked bar.** `src/ui/search-action.ts:setSearchAction`. The button is there only where there is something to search.
* **A Quick Settings search request is held until Bookmarks shows.** `search-action.ts:requestSearch` and `useSearchWanted`. The request is taken once, so it is not repeated on the next visit.
* **A floating search bar that is open is marked for the tab bar.** `search-action.ts:setSearching`.
* **The search count follows typing only after a pause.** `src/ui/search-count.ts`. The count is shown and read out after typing stops, not on each key.
* **Search opened from a button leaves filtering to the screen.** `floating-actions.tsx:useSearch`. The screen filters its own page by the query.
* **The docked bar's search is the bar's own button.** `floating-actions.tsx`, the docked branch.

### Bottom sheets and dialogs

* **A sheet is mounted only while it is open or sliding away.** `src/ui/bottom-sheet.tsx:BottomSheet`. Every opening starts clean, with nothing measured or left over.
* **The sheet is below the screen until it is measured.** `bottom-sheet.tsx:slide`. It is hidden until then, so it does not flash in the wrong place.
* **The open animation runs once.** `bottom-sheet.tsx:timer`. The content can change size after the first measurement. Restarting the slide for each change made the sheet flicker.
* **A keyboard left over from an earlier input is ignored when a sheet opens.** `bottom-sheet.tsx:openedRef`. It would push the sheet up for nothing.
* **The keyboard's room is padding, so the sheet shrinks to what is left above it.** `bottom-sheet.tsx:drag`. It is animated on the JS thread, apart from the sheet's own slide on the native one.
* **The keyboard covers the bottom edge, so its room replaces the bottom inset.** `bottom-sheet.tsx:next`.
* **A tall sheet body gives way to the keyboard and scrolls.** `bottom-sheet.tsx:styles`.
* **A dialog centres in the room above the keyboard, and a long message scrolls.** `src/ui/dialog.tsx`, `close`.
* **A dialog stays on screen for its fade-out.** `dialog.tsx:asked`. It is kept after it closes.
* **The back button and a tap outside are cancel.** `dialog.tsx:DialogAction`. Destructive actions use the danger colour.

### Keyboard

* **Android does not always report the keyboard closing.** `src/ui/keyboard.ts:verify`. A drawer's input can go away with the keyboard still believed open, which leaves the next drawer floating mid-screen. The window's own height is asked and corrects the belief in either direction. Without native support the fallback is the one certain thing: no focused input means no keyboard (`settleKeyboard`).
* **The reported height stops at the navigation bar.** `keyboard.ts:verify`. The keyboard is drawn behind it, so what it covers runs from its top edge to the bottom of the screen.
* **The window is asked again a moment after the events settle.** `keyboard.ts:VERIFY_AFTER_MS`.
* **The animated copy of the height follows the real one.** `keyboard.ts:useKeyboardHeight`. It is for layout that must move smoothly, such as a drawer's room for the keyboard.
* **A screen's bottom room is the keyboard's height or the tab bar's.** `keyboard.ts:keyboardInset`. The tab bar is out of the way while the keyboard is up, so the two never add up.
* **The keyboard's height is a plain value for a list's bottom room.** `keyboard.ts:actual`.
* **Timing constants are the ones tested on device.** `keyboard.ts:SNAP_AFTER_MS` and `POLL_MS`. See Excuses for the polling.

### Motion

* **Every animation runs at a fraction of its drawn length.** `src/ui/motion.ts:SPEED`. The app feels quick.
* **System reduced motion jumps straight to the end.** `motion.ts:reduced`, and `motion`. Android's Remove animations and iOS's Reduce Motion both turn it on.
* **The spring is stiffer than React Native's default.** `motion.ts:motion`. It settles fast.
* **A screen's content fades back in when its key changes, but not on first show.** `motion.ts:spring`. Going between a list and one of its items is not a hard cut.

### Theme and colour

* **The phone's accent is read once, at start.** `src/ui/theme.ts`, the system accent. It does not follow later changes.
* **The iOS light look uses the system colours.** `theme.ts:iosLight`. Grouped grey background, white cards, system blue.
* **A site's avatar colour comes from its host name.** `theme.ts:AVATAR_HUES`. The same site always gets the same avatar.
* **An accent is adjusted until text on it reads.** `src/ui/accent.ts:mix`. The accent moves toward black or white. The default and the system colour where the phone has none are left as they are.
* **Text on a solid colour is white or near black, whichever reads better.** `theme.ts:soften`.
* **The snackbar's action is light on the dark bar.** `src/ui/snackbar.tsx:actionColor`. The accent in dark theme, the tint in light.
* **The colour bars run from a deep to a pale shade of the hue.** `src/ui/color-picker.tsx`, the shade bar. Choosing the selected colour again keeps it, and only None clears it.

### Glass (iOS look)

* **Glass is an approximation.** `src/ui/glass.tsx:GlassKind`. iOS 26's material bends light; this only blurs and tints, because Android has no such material.
* **Glass is drawn only for the iOS look, with the effect on.** `glass.tsx:useGlass`.
* **Older Android gets the glass tinted but not blurred.** `glass.tsx:useGlass`. Android 12 is where the blur is cheap on the GPU. Before it the software blur is too slow.
* **The blur radius is the intensity divided by 25 dp.** `glass.tsx:BLUR_REDUCTION`. Twenty-five is as far as the library goes.
* **Each screen's list is the one view the glass blurs.** `glass.tsx:readTarget`. Only the iOS look has one.
* **A blur waits for the commit that stores its target.** `glass.tsx:blurTarget`. A blur view throws if its target is already gone, and the next screen's buttons mount while the last screen's target is still stored.
* **Glass without a blur to hide what is behind is nearly opaque.** `glass-colors.ts:GLASS`.
* **The veil covers more where text sits.** `glass-colors.ts:BLUR_VEIL`. The search bar is the most covered; the accent button is nearly solid so its icon keeps its contrast.
* **Glass colours are pure functions, so contrast is tested.** `src/ui/glass-colors.ts`. The contrast ratio is tested without the device.
* **The soft light on the top edge is strips that fade out, clipped by the shape.** `glass.tsx:HIGHLIGHT`.

### Lists and rows

* **The list view's rows slide in from the side they come from.** `src/ui/folder-list.tsx:shape`. The list arrives from the left as if coming back, and an opened folder's bar from the right.
* **Scroll state marks the page only after a step.** `src/ui/scroll-state.ts:STEP`. A finger's jitter does not flip the bar. Near the top the bar is always full.
* **Icon rows are drawn lazily.** `src/ui/icon-picker.tsx:label`. About a hundred buttons at once held up the drawer.
* **Typing in the icon name field does not draw the drawer again.** `icon-picker.tsx:IconPicker`.
* **The icon drawer has a fixed height.** `icon-picker.tsx:styles`. It is the same size before and after its rows are drawn.
* **A swiped row can be used without the gesture.** `src/ui/swipe-row.tsx:MAX`. Screen reader users get the same actions through `accessibilityActions`.
* **Only the part that spreads the pan handlers starts the swipe.** `swipe-row.tsx:SwipeRow`. A card's header, not the whole row.
* **Both sides of the reveal sit under the row.** `swipe-row.tsx:ink`. Only the side being dragged may show.
* **Icons for a column come from the extension's Lucide set.** `src/ui/column-icons.ts`. Each one maps to the closest Ionicons glyph.
* **A column with no colour gets a steady one from its name.** `column-icons.ts:shades`. The same column is easy to spot.
* **Media kinds are spoken in a row's label.** `src/ui/bookmark-icon.tsx:KIND_ICONS`. Other links say their kind with their tags.
* **A bookmark's kind is read from its address each time.** `bookmark-icon.tsx`. See `link-kind.ts`.
* **A Back action runs the newest active screen's handler first.** `src/ui/back-actions.ts:latest`.
* **A sync problem shows where the sync is.** `src/ui/sync-problem-banner.tsx`. A stopped sync has no Dismiss and goes away when the server or app is updated. Missing features can be dismissed on this phone until the server or the list changes.
* **Plain iOS buttons are bare text; Material ones are outlined.** `src/ui/widgets.tsx`, the button.
* **A field's border never changes width.** `widgets.tsx:border`. Focusing or flagging a field cannot move what is around it. The focus ring is drawn outside the layout.
* **A saved quote's passage link reads "Go to passage".** `src/ui/note-text.tsx`. Without `onOpen`, while selecting, the label only shows.

## Excuses

Two workarounds in `src/ui/keyboard.ts` were justified by comments. The comments are deleted. The hacks, and their fixes, are listed in #496.

* `keyboard.ts`, `POLL_MS` and the polling loop: the window is asked every few hundred milliseconds while the keyboard is believed open, because Android sometimes closes it without an event.
* `keyboard.ts:setHeight`: an animation that never reached its end left drawers lifted for a keyboard that was gone, so the value is set outright once it should have finished.
