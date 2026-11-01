## What and why

<!-- What does this change, and which issue does it address? -->

## Model

<!-- Product name and exact model ID that did the work, for example Claude Sonnet 5.5 (claude-sonnet-5-5). List each model and what it did if several contributed. Write "Human only" if no model was used. -->

## Checklist

- [ ] `vp run check` and `vp run build` pass, or I have explained which checks I couldn't run
- [ ] Tests cover the change, or I have explained why they aren't needed
- [ ] For runtime changes, I tested the affected workflow in the dev browser and recorded the steps and result below
- [ ] A fix or feature has proof below (screenshot, recording, or output, with a before and after for a fix)
- [ ] UI changes work with the keyboard alone and in both themes, anything done by dragging or hovering has a keyboard alternative, and `vp run a11y` passes
- [ ] For UI changes, I listed the keyboard and accessibility checks or tools used, workflows tested, and limitations below
- [ ] I ran the `unslop-*` skills on the changed files only and fixed what they found
- [ ] I reviewed the full diff, every changed file supports this request, and unrelated changes are removed
- [ ] Any new permissions are justified and documented; no remote code or background network calls were added
- [ ] Storage changes preserve older data and include a migration where needed
- [ ] Affected docs, Help, website copy, and screenshots are current

## Validation evidence

- Automated checks and results:
- Browser used, steps, and observed result:
- Proof (screenshot, recording, or output), or why browser validation is not applicable:
- Scope review, including why each changed file is needed:
