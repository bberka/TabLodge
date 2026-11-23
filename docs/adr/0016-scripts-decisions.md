# 16. Repository tooling decisions that were code comments

Status: accepted, 2026-11-23. Issue #442.

## Context

The repository scripts (`scripts/`), the root `vite.config.ts`, and `xo.config.ts` carried their reasons as comments. Comments are banned ([Code comments](../agents/comments.md)), so the reasons live here with the file and symbol or rule that carries each. The extension's own build scripts (`apps/extension/scripts/`) are a separate area. How the checks fit together is in [Validation](../agents/validation.md), [Workflow](../agents/workflow.md), and [CI](../agents/ci.md).

## Decisions

### Scripts

* **The agent instruction size is budgeted** (`scripts/agent-context.ts`). Agents read `AGENTS.md`, the per folder `AGENTS.md` files, and the `docs/agents` page that matches the task, and each byte costs every session. The budget file records the current size, so a pull request that adds instructions shows the growth in its diff. CI rejects growth over master's budget unless the pull request carries the `agent-context-increase` label, which sets `ALLOW_INCREASE=true`. Commands: no argument fails unless the budget matches the files; `--write` rewrites the budget; `--base <ref>` also fails when a size is above the one at `<ref>`. `baseBudget` returns nothing while the base has no budget file, which is the case until the pull request that adds it merges.
* **`vp run check:changed` is a quick loop, not the gate** (`scripts/check-changed.ts`). It lints, type checks, and tests only what differs from `origin/master`. The pre-push hook and the validation gate still run `vp run check` in full, because a change can break a file it did not touch in ways `--changed` cannot see (a renamed export, a shared type).
* **Evidence uploads make no push** (`scripts/publish-evidence.ts`). It uploads proof images to the `evidence` branch through the GitHub contents API and prints Markdown for the pull request body (`vp run evidence <pr-number> <file>...`; needs `gh` signed in with write access). Since no `git push` happens, the Git hooks do not run. The branch is only a file host; nothing merges from it. On first use the branch starts at the default branch's head. A file with no earlier upload has no `sha` to replace, so the failed lookup is the expected case.
* **Release versions are ZeroVer** (`scripts/release-version.ts`): every release is `0.<minor>.<patch>`. `<minor>` comes from the root `VERSION` file. `<patch>` comes from the existing `v0.*` release tags: no release for the minor gives `.0`, a latest release with the same minor gives patch + 1, and a `VERSION` below the latest released minor is an error, so versions never go backwards. `next` prints the next version, `set` writes it into `apps/extension/shell/manifest.json`, `set-android` writes the version and version code into `apps/mobile/app.json`, and `set-server` writes it into `apps/server/package.json`, which the server reports at `/v1/status`. Only the image build runs `set-server` (`.github/workflows/sync-server.yml`): the committed Cloudflare Worker is built from the unstamped file, so the release checks keep finding it current. The release workflow also runs it for the `worker.js` on the `release` branch (`scripts/release-branch.sh`).
* **Version files are edited as text** (`stampVersion`). It replaces the top level `"version"` value and leaves the rest byte for byte, because re-serializing would fail `vp run check`. `stampAndroid` is the exception: it rewrites `app.json` as JSON with tab indentation, which is how the repository keeps it.
* **The Android version code grows with the version** (`androidVersionCode`). Android installs an update only with a higher code, so 0.2.5 gives 2005, and a minor or patch of 1000 or more is refused rather than collide.
* **Third party notices come from what a build ships** (`scripts/third-party-notices.ts`). They are shared by the extension build (`THIRD_PARTY_NOTICES.txt` in each package) and the Android app (`apps/mobile/scripts/licences.mts`, the Open source licences screen). The input is the build's own module list: the files Vite or Metro put in a bundle, and for Android the libraries on Gradle's release classpath. Every package found there needs a licence id and a licence text, or the script throws, so a build cannot ship a package with no entry.
  * Licences with a standard text in `scripts/licence-texts` cover packages that ship no licence file.
  * A bundled file belongs to the nearest `package.json` with a name and a version. Nested ones that only set `type` or `main` are skipped (`scripts/third-party-notices.test.ts`, `a bundled file belongs to the nearest package.json with a name and version`).
  * Apache-2.0 asks for a copy of the licence itself, and many packages ship only the short header that points to it, so `withFullApache` adds the full text after the header when it is missing. A package's `NOTICE` file is added when it has one.
  * A bare CSS `@import` such as `@import 'tailwindcss'` is inlined by PostCSS, so the package never shows up as a module of the bundle; `cssImportDirs` finds those folders. The app's own files count only for the packages their CSS imports. Paths that do not exist (Metro's virtual modules, Vite's `\0` helpers) are skipped.
  * For Android, `spdxFromPom` maps the names POM files use to SPDX ids, and a name not listed fails the build until someone adds it. A Maven artifact carries the licence its POM names, with the standard text, because a POM holds no licence text and most AARs ship none. Gradle projects are npm packages with native code; those outside `node_modules` are the app's own modules and are skipped. The text for a licence is the same for every artifact, so the app data stores it once.
  * Metro source maps give paths relative to the repository root with a leading slash; `fromMetroSource` resolves them.

### Root configuration

* **`vite.config.ts` serves tests and staged files.** It configures `vp test` (the tests of each app are in `apps/<app>/tests`, the scripts' in `scripts/`) and `vp staged` for the pre-commit hook (`.hooks/pre-commit`). Linting and formatting use XO (`xo.config.ts`). The hook only checks; `vp run lint:fix` fixes. The extension is built by `apps/extension/scripts/build.ts`.
* **XO is the linter** (`xo.config.ts`) with its default style, Prettier formatting, and React rules. `vp run lint` checks and `vp run lint:fix` (alias `vp run format`) fixes and formats. Every rule turned off or relaxed has its reason below; prefer fixing the code over adding to the list.
* **Type aware rules use the real compiler options.** The `**/*.{ts,tsx,mts,cts}` entry lists the app tsconfig files, because `tsconfig.json` is only a solution file (paths, JSX, chrome and vite types come from the others). The `chrome` and `window` globals are declared so that `chrome.api?.method` feature checks lint as intended.
* **The tsconfig files and `wrangler.jsonc` are JSONC** (`language: 'json/jsonc'`), because they carry explanatory comments.
* **Tailwind's `@theme` and `@source` are not standard CSS,** so `apps/extension/styles/**/*.css` gets a custom syntax for them.
* **`apps/server/src/node.ts` may call `process.exit`** (`unicorn/no-process-exit`): the Docker entry point starts the process and exits on bad configuration, like a CLI.
* **`mobile` and `server` do not import extension pages or build scripts** (`no-restricted-imports`). They share `apps/extension/src/shared` ([cross-app](../agents/cross-app.md)).
* **Ignored paths.** The fixtures `apps/extension/tests/fixtures/page-copy/**` are web pages as sites send them, for the copy extractor's tests, and formatting them would change what is tested. `apps/extension/tests/fixtures/site-sources/**` are copies of third party site markup (duplicate ids and all) that the Sources adapter tests read.

### Rules turned off or relaxed (`xo.config.ts`)

| Rule | Reason |
| --- | --- |
| `@typescript-eslint/strict-boolean-expressions` | Truthiness checks on strings, numbers, and optional values are the house style; untrusted input is normalized everywhere. |
| `@typescript-eslint/prefer-nullish-coalescing` | `\|\|` is used on purpose to also replace empty strings and 0; `??` would change behavior. |
| `@typescript-eslint/no-restricted-types` | `null` is what Chrome APIs, JSON, React refs and state, and stored data already use; the rule would rewrite hundreds of types and the code that produces them. |
| `@typescript-eslint/no-base-to-string` | `String(untrusted)` is the deliberate coercion for values read from imports, forms, and messages. |
| `@typescript-eslint/promise-function-async` | Adding `async` to functions that return a promise changes how synchronous throws surface and adds noise to one line callbacks. |
| `@typescript-eslint/no-empty-function` | `() => {}` is the standard no-op for swallowed promise rejections and default callbacks. |
| `@typescript-eslint/strict-void-return`, `no-confusing-void-expression` (arrow shorthand allowed) | Shorthand callbacks such as `(open) => !open && close()` and `() => send()` are the idiom for React handlers and Chrome listeners. |
| `@stylistic/curly-newline`, `@stylistic/no-mixed-operators` | Prettier owns brace layout and drops the clarifying parentheses in `a + (b / 2)`; these rules would fight it forever. |
| `no-useless-escape` | `regexp/no-useless-escape` already checks regular expressions, and it wants the `\-` that `regexp/sort-character-class-elements` places last in a class. |
| `unicorn/prefer-block-statement-over-iife` | The theme boot script is an IIFE so its variables stay out of the global scope of a classic script. |
| `@typescript-eslint/no-empty-object-type` (`allowObjectTypes: 'always'`) | `{}` marks "no extra fields" in the message map, and `{} extends Fields` is how optional arguments are derived. |
| `@typescript-eslint/consistent-type-assertions` (object literal assertions allowed) | Object literals with computed keys (`{[name]: value} as Partial<Settings>`) cannot be typed without an assertion. |
| `@typescript-eslint/switch-exhaustiveness-check` (`considerDefaultExhaustiveForUnions`) | `handleMessage` switches on untrusted message types, so its `default` branch is the exhaustive case. |
| `no-void` | `void promise` marks intentional fire and forget calls, as `no-floating-promises` expects. |
| `eqeqeq` (null ignored), `no-eq-null` | `value != null` is the idiom for "neither null nor undefined". |
| `n/file-extension-in-import` | Scripts import `.ts` files for Node's type stripping while the app uses extensionless bundler imports; the fixer would break both. |
| `require-unicode-regexp`, `regexp/prefer-named-capture-group` | Adding the `u` or `v` flag or named groups to every pattern is churn with a risk of changing how patterns match. |
| `unicorn/prefer-unicode-code-point-escapes` | Code point escapes need the `u` flag (see above); `\u0000` in a sanitizer is clearer than `\u{0}`. |
| `regexp/no-super-linear-backtracking`, `regexp/no-super-linear-move`, `regexp/no-contradiction-with-assertion` | The import parsers are bounded by `MAX_IMPORT_BYTES`; rewriting their patterns risks changing what imports match. |
| `complexity`, `max-params`, `max-lines`, `max-depth`, `unicorn/max-nested-calls` | Size and complexity limits: the service worker is one large message dispatcher by design, and it must stay a single classic script. |
| `no-await-in-loop` | Sequential awaits are intentional: Chrome tab and window operations must run in order. |
| `unicorn/no-await-expression-member` | `(await chrome.tabs.query({}))[0]` and `(await getStore()).settings` read clearly with Chrome's promise APIs. |
| `unicorn/consistent-boolean-name`, `unicorn/name-replacements`, `unicorn/catch-error-name` | Naming opinions that would rename props, parameters, and event handlers across the app. |
| `unicorn/prefer-simple-condition-first`, `unicorn/prefer-else-if`, `@typescript-eslint/prefer-optional-chain` | Reordering conditions or merging adjacent ifs is only safe when side effects and evaluation order are proven unaffected. |
| `unicorn/no-unreadable-array-destructuring`, `unicorn/prefer-then-catch` | `[a[i], a[j]] = [a[j], a[i]]` is the standard swap; `.then(run, run)` runs the next job after success or failure on purpose. |
| `unicorn/no-immediate-mutation`, `unicorn/no-break-in-nested-loop`, `unicorn/no-object-as-default-parameter` | Style only restructuring that is not safe to automate. |
| `unicorn/prefer-number-coercion` | `parseInt` is deliberate where leading digits are read from a longer string. |
| `unicorn/prefer-iterator-to-array`, `unicorn/prefer-iterator-helpers`, `unicorn/prefer-set-methods` | Iterator helpers and Set methods (Chrome 122) are newer than `minimum_chrome_version` 116. |
| `unicorn/prefer-spread` | `Array.from` also accepts array likes (`DataTransfer.types`, `DOMStringList`); spreading them throws. |
| `unicorn/no-useless-coercion`, `@typescript-eslint/no-unnecessary-type-conversion` | Autofix hazard: the rule dropped `Boolean(error)` on an `unknown` value, changing what is stored. |
| `unicorn/no-unnecessary-global-this` | `globalThis.ClipboardItem` is deliberate: a bare identifier throws a `ReferenceError` where the class does not exist (service worker, Node tests). |
| `unicorn/prefer-top-level-await` | Page entry modules fire a promise on purpose; top level await would hold up rendering. |
| `react-hooks/set-state-in-effect`, `react-hooks/refs` | React Compiler diagnostics; the project does not use the compiler and the flagged patterns are deliberate. |
| `@eslint-react/no-array-index-key` | Lists derived from a text split or an import preview have no stable ids and are never reordered. |
| `jsx-a11y-x/label-has-associated-control` (`controlComponents: ['Checkbox']`) | The shadcn `Checkbox` renders the form control a label wraps. |
| `jsx-a11y-x/no-autofocus` | Dialog fields take initial focus on purpose; Radix traps focus in the dialog and restores it on close. |

### Rules turned off for some files

| Files | Rules | Reason |
| --- | --- | --- |
| `apps/extension/shell/*.html` | `@html-eslint/require-meta-description`, `require-open-graph-protocol`, `head-order` | HTML shells are extension pages, not public web pages; the order of the boot script, styles, and bundle in `<head>` is deliberate. |
| `package.json` | `package-json/prefer-shorthand` | `repository` and `bugs` stay objects (`apps/extension/src/app/project.ts` reads `repository.url`). |
| `apps/extension/package.json` | `package-json/dependency-version-range` | Tailwind is pinned to an exact version on purpose; the config is version specific. |
| the files that strip control characters (service worker, `bookmark-rules.ts`, `library-normalize.ts`, `session-folders.ts`, `import-formats.ts`, `bookmark-drag.ts`, and three more under `src/app`) | `no-control-regex`, `regexp/no-control-character` | Sanitizers strip C0 control characters from untrusted titles and URLs on purpose. |
| `apps/extension/shell/service-worker.ts` | `@typescript-eslint/consistent-type-imports` | The service worker is a classic script that tests type strip and run in a VM, so it cannot use `import type` statements; `import("...")` types keep it self contained. |
| `apps/extension/src/components/ui/**` | `@eslint-react/no-forward-ref`, `no-context-provider`, `no-use-context`, `naming-convention-ref-name`, `naming-convention-id-name`, `jsx-a11y-x/heading-has-content` | Shadcn style primitives mirror the upstream generator output (`forwardRef`, `Context.Provider`, `useContext`), which is updated by regenerating, not by hand. Heading primitives receive their content through `children` at the call site. |
| `apps/*/tests/**`, `scripts/**/*.test.ts` | `@typescript-eslint/naming-convention`, `@eslint-react/naming-convention-context-name`, `no-script-url` | Tests mock Chrome and web platform globals (`getURL`, `WINDOW_ID_NONE`, `URL`), feed `javascript:` URLs to the sanitizers, and name `vm.createContext` results `context`. |
| `apps/extension/scripts/vite-shared.ts`, `manifest-targets.ts` | `@typescript-eslint/naming-convention` | `homepage_url`, `sidebar_action` and the other manifest keys are not our naming choice. |
| `apps/extension/scripts/verify-build.ts` | `no-new` | Constructing `vm.Script` is the syntax check; the instance itself is not needed. |
| `apps/extension/src/app/options.tsx` | `unicorn/no-computed-property-existence-check` | The settings page reads boolean setting values by dynamic name; presence is not the question there. |
| `apps/extension/src/app/help.tsx` | `@typescript-eslint/no-deprecated` | Lucide-react marks its brand icons deprecated, but it is the only GitHub mark the bundled icon set offers. |
| `apps/mobile/package.json` | `package-json/dependency-version-range`, `prefer-type-module`, `prefer-exports`, `require-engines`, `no-orphan-script-hooks` | Expo pins exact SDK versions (`expo install --check` enforces them), and Metro expects a CommonJS style `main` entry. |

## Consequences

* A rule in `xo.config.ts` is justified here. Changing a rule means changing its row.
* Tests state the third party notices behavior; the rest relies on this document and on review.
