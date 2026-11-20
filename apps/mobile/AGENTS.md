# Android app

Load [mobile.md](../../docs/agents/mobile.md) before editing here. Proof comes from an emulator or a device, never the browser.

- Start your own emulator and target it by serial in every `adb` command. Another session may be using the one that is running.
- Pure logic goes in a plain `.ts` file with a test in `tests/`, not in a screen. Screens cannot run in the Node tests.
- Do not edit the PNGs in `assets/`. Change `scripts/make-icons.mts` and rerun `pnpm run mobile:icons`.
- Do not add tab reordering, splitting or merging sessions, or library size limits. The owner left them out on purpose.
- Code imported from `apps/extension/src` must stay free of browser APIs.
