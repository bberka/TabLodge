# Contributing to TabLodge

Bug reports, ideas, and pull requests are welcome. If you're planning a larger change, open an issue first so we can discuss the approach before you spend time on it.

## Get set up

Follow the [source installation steps](README.md#build-from-source) and load `dist/tablodge/` in your browser. Keep using the same build folder: loading it from another path can give the extension a different ID and separate storage. Export your data before moving it.

Install the Vite+ CLI once as described in [README Development](README.md#development), then run `vp run dev` while you work. It rebuilds when files change and opens Chrome or Chromium with the extension loaded in a dedicated profile for this worktree. After each rebuild, reload the extension at `chrome://extensions` and reopen its pages. This profile keeps test data separate from your regular browser profile. Use `vp run <task>` for the other scripts in the [README command list](README.md#development).

For code locations and how the pieces fit together, see the [project structure](README.md#project-structure) and [architecture notes](architecture.md).

## Code conventions

- Use strict TypeScript without `any` escapes. Validate stored data, imports, and messages before using them. The service worker treats incoming data as untrusted.
- Use XO for both linting and formatting. Run `vp run lint:fix`, or `pnpm exec xo --fix <files>` for just the files you changed. Don't run another formatter. Review automatic fixes because some can change behavior.
- Keep rule exceptions in `xo.config.ts`, with a short reason and a narrow file scope. If one line needs an inline exception, explain it with `// eslint-disable-next-line <rule> -- <reason>`.
- Use Tailwind theme tokens such as `bg-background` and `text-muted-foreground` rather than raw colors. Check both light and dark themes.
- Build controls from the local Radix components in `src/components/ui/`, exposed through `src/shared/ui.tsx`. To add a primitive, run `pnpm dlx shadcn@latest add <component>` and review the generated code.
- Use icons from `lucide-react`. Controls must work with a keyboard, have visible focus, and have labels. Pair icon buttons with `aria-label` and `IconTooltip`. Announce feedback with an appropriate status or alert role.
- Bundle dependencies locally. Don't add CDN imports, remote fonts, or network calls. A new permission needs a clear reason and documentation in the [permissions table](README.md#permissions-and-privacy) and [privacy policy](PRIVACY.md).
- Read the display name from `PROJECT.name` in pages or `APP_NAME` in the worker. Both use the manifest's `short_name`. Changes to storage keys, export format identifiers, drag MIME types, or context menu IDs need a migration.
- External links should use `target="_blank" rel="noopener noreferrer"`.

## Accessibility

TabLodge is used by keyboard and with screen readers, so every UI change meets [WCAG 2.2 AA](https://www.w3.org/TR/WCAG22/) for what it touches. Check these before you write the UI, not after:

- **Everything works from the keyboard.** Anything done by dragging, hovering, or right-clicking has a keyboard alternative. Reordering sessions, bookmark columns, and bookmarks is available as **Move up**, **Move down**, **Move left**, and **Move right** in their menus. Keep drag as well; do not replace it.
- **Use the native element or the Radix primitive.** A `button` for actions, an `a` for navigation, Radix for dialogs, menus, selects, and tooltips. If you build a custom control, follow its [WAI-ARIA pattern](https://www.w3.org/WAI/ARIA/apg/patterns/): roles, states, and keys. A radio group, for example, has one tab stop and uses arrow keys (see `src/shared/radio-keys.ts`).
- **Name and state.** Icon only buttons have an `aria-label` that includes what they act on. Toggles expose `aria-expanded`, `aria-pressed`, `aria-checked`, or `aria-current`. Decorative icons and duplicate images are `aria-hidden`.
- **Focus.** Focus is visible, follows reading order, and never ends up on the page body. After an action that removes or moves the focused element, put focus somewhere sensible: `src/shared/focus-rescue.ts` covers removal, and `focusAfterMove` in `src/app/reorder.ts` covers moving. Dialogs return focus to what opened them without extra code (the shared dialog components do it, including for a dialog opened from a menu item), and menus do the same.
- **Announce results.** Success, errors, and changes with no visible focus move go through `showStatus` so a screen reader hears them. A search says how many results it found (`status` on `ExpandingSearch`, or a `role="status"` region next to the field). Do not rely on color, position, or animation alone.
- **Targets and contrast.** Interactive targets are at least 24 by 24 CSS pixels, or have enough spacing. Text and controls meet contrast in both themes. Respect reduced motion.
- **Pages with the shared header** get the skip link from `AppHeader`. A new page with its own navigation adds one.

Run `vp run build` and then `vp run a11y`. It runs axe-core on every extension page in both themes and exercises the keyboard workflows above. Add a check to `scripts/a11y-check.ts` when you add a workflow that needs the keyboard. Automated checks cannot judge reading order, announcements, or whether a workflow makes sense, so also use the feature with the keyboard alone and with a screen reader (for example NVDA or Orca in Chrome) and write down the browser, the assistive technology, what you tested, and what is left in the pull request.

## Writing documentation

Use plain language, short paragraphs, and direct instructions. Describe what a person can do and what to expect, rather than listing implementation terms without context.

Do not use em dashes or en dashes in prose. Rewrite sentences instead of using a dash as punctuation. Avoid hyphenated wording when a natural alternative exists. Keep hyphens only where needed for Markdown syntax, exact names, paths, URLs, commands, code, or a technical term that would be unclear without one.

Keep each topic in one main place and link to it from elsewhere. Remove obsolete notes rather than leaving old behavior beside the current instructions. When behavior changes, check the README, architecture notes, privacy policy, website, and Help. Update screenshots when the UI they show changes; [website setup](website.md#screenshots) explains how they're captured.

## Test your change

The worker tests run `extension/service-worker.ts` in a Node VM with mocked browser APIs. Add regression tests for bug fixes and cover behavior changes in the relevant suite. Extend the mock when you use another browser API. Pure helpers should have direct unit tests.

Mocks can't catch everything. For runtime changes, follow [Agent validation and PR gate](agent-validation.md) to load the build in the dev browser, exercise the affected workflow, and record evidence. For UI changes, check keyboard use and both themes, and run `vp run a11y` (see [Accessibility](#accessibility)).

Before opening a pull request, follow [Agent validation and PR gate](agent-validation.md) and run:

```sh
vp run check
vp run build
```

In the pull request, explain what changed, why it changed, and how you tested it. Mention any checks you couldn't run. Call out new permissions and storage changes, including how older data is handled. Describe changes people will notice so they can be included in release notes.

## Working with AI agents

Agents follow [AGENTS.md](../AGENTS.md). In short:

- Work on a branch and open a pull request. Nobody, human or agent, pushes to `master` directly.
- The pull request names the model that did the work, and commits carry only the human author.
- Every fix or feature includes proof in the pull request, such as a screenshot, recording, or test output, with a before and after for a fix.
- Before pushing, run the `unslop-*` skills on the changed files only. Install the pinned skills in `skills-lock.json` with `vp run skills:install`.

## Releases

TabLodge uses [ZeroVer](https://0ver.org): `0.<minor>.<patch>`.

The root `VERSION` file holds the minor number. The release workflow computes the patch from the latest matching tag. For example, with `VERSION` set to `1` and a latest release of `0.1.1`, the next release is `0.1.2`. Set `VERSION` to `2` and the next release is `0.2.0`. The minor number cannot go below the latest released minor.

Run **Actions › Release › Run workflow** on `master` to publish a release. The workflow stamps the version into `package.json` and `extension/manifest.json`, runs the checks and build, publishes the ZIP and its SHA256 checksum under a `v0.x.y` tag, and triggers the website deployment. It also dispatches the Chrome Web Store workflow, which verifies the release ZIP, uploads it to the existing listing, and submits it for publication. Google review may delay when the update becomes available. To build and package the extension locally, follow the [README build steps](README.md#build-from-source).

### Chrome Web Store publishing

Before the first release, enable the Chrome Web Store API in a Google Cloud project and create OAuth credentials authorized with the `https://www.googleapis.com/auth/chromewebstore` scope. Generate a refresh token for the Google account that owns the existing listing. If the OAuth consent screen remains in Testing, Google may expire the refresh token after seven days, so configure a production consent screen for ongoing automation.

In GitHub repository **Settings › Secrets and variables › Actions**, add the `CWS_PUBLISHER_ID` repository variable using the publisher ID from the Chrome Web Store Developer Dashboard. Add these repository secrets:

- `CWS_CLIENT_ID`
- `CWS_CLIENT_SECRET`
- `CWS_REFRESH_TOKEN`

The workflow already uses TabLodge's existing extension ID. It runs after each GitHub release. If a submission needs to be retried, run **Actions › Chrome Web Store › Run workflow** and enter the published version, such as `0.1.4`.

`vp run version:next` shows the next version based on your local tags.

By contributing, you agree to license your contributions under the [MIT License](../LICENSE).
