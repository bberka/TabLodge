# Android app

Load [mobile.md](../../docs/agents/mobile.md) before editing here. Proof comes from emulator or device, never browser.

- Start own emulator, target by serial in every `adb` command. Another session may use running one.
- Put pure logic in plain `.ts` file with test in `tests/`, not in screen. Screens cannot run in Node tests.
- Do not edit PNGs in `assets/`. Change `scripts/make-icons.mts`, rerun `pnpm run mobile:icons`.
- Do not add tab reordering, splitting or merging sessions, or library size limits. Owner left out on purpose.
- Keep code imported from `apps/extension/src` free of browser APIs.
