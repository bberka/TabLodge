# Contributing to TabLodge

Bug reports, ideas, and pull requests are welcome. If you're planning a larger change, open an issue first so we can discuss the approach before you spend time on it.

## Get set up

Follow the [source installation steps](README.md#build-from-source) and load `dist/tablodge/` in your browser. Keep using the same build folder: loading it from another path can give the extension a different ID and separate storage. Export your data before moving it.

Install the Vite+ CLI once as described in [README Development](README.md#development), then run `vp run dev` while you work. It rebuilds when files change and opens Chrome or Chromium with the extension loaded in a dedicated profile for this worktree. After each rebuild, reload the extension at `chrome://extensions` and reopen its pages. This profile keeps test data separate from your regular browser profile. Use `vp run <task>` for the other scripts in the [README command list](README.md#development).

For code locations and how the pieces fit together, see the [project structure](README.md#project-structure) and [architecture notes](docs/architecture.md).

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

## Writing documentation

Use plain language, short paragraphs, and direct instructions. Describe what a person can do and what to expect, rather than listing implementation terms without context.

Do not use em dashes or en dashes in prose. Rewrite sentences instead of using a dash as punctuation. Avoid hyphenated wording when a natural alternative exists. Keep hyphens only where needed for Markdown syntax, exact names, paths, URLs, commands, code, or a technical term that would be unclear without one.

Keep each topic in one main place and link to it from elsewhere. Remove obsolete notes rather than leaving old behavior beside the current instructions. When behavior changes, check the README, architecture notes, privacy policy, website, and Help. Update screenshots when the UI they show changes; [website setup](site/README.md#screenshots) explains how they're captured.

## Test your change

The worker tests run `extension/service-worker.ts` in a Node VM with mocked browser APIs. Add regression tests for bug fixes and cover behavior changes in the relevant suite. Extend the mock when you use another browser API. Pure helpers should have direct unit tests.

Mocks can't catch everything. For runtime changes, follow [Agent validation and PR gate](docs/agent-validation.md) to load the build in the dev browser, exercise the affected workflow, and record evidence. For UI changes, check keyboard use and both themes.

Before opening a pull request, follow [Agent validation and PR gate](docs/agent-validation.md) and run:

```sh
vp run check
vp run build
```

In the pull request, explain what changed, why it changed, and how you tested it. Mention any checks you couldn't run. Call out new permissions and storage changes, including how older data is handled. Describe changes people will notice so they can be included in release notes.

## Releases

TabLodge uses [ZeroVer](https://0ver.org): `0.<minor>.<patch>`.

The root `VERSION` file holds the minor number. The release workflow computes the patch from the latest matching tag. For example, with `VERSION` set to `1` and a latest release of `0.1.1`, the next release is `0.1.2`. Set `VERSION` to `2` and the next release is `0.2.0`. The minor number cannot go below the latest released minor.

Run **Actions › Release › Run workflow** on `master` to publish a release. The workflow stamps the version into `package.json` and `extension/manifest.json`, runs the checks and build, publishes the ZIP and its SHA256 checksum under a `v0.x.y` tag, and triggers a website deployment with the new version. To build and package the extension locally, follow the [README build steps](README.md#build-from-source).

`vp run version:next` shows the next version based on your local tags.

By contributing, you agree to license your contributions under the [MIT License](LICENSE).
