# Spec driven development

Spec = contract. Change done when every acceptance criterion has proof, and code does nothing spec does not ask for. Spec lives in one place, GitHub issue ([Issues](issue-tracker.md)), and pull request points back to it.

## What counts as the spec

| Change | Spec |
| --- | --- |
| Feature: new behavior, data, setting, sync, or link handling | An issue in the format below |
| Fix | The bug report: its steps reproduce the bug and its expected result is the criterion |
| Refactor, docs, tooling | One sentence in **What and why** of the pull request, naming what must stay true |

Feature without issue gets one before first edit. Write from request and code with `to-spec` skill (no interview) or by hand in format below, publish with `gh issue create`, go on. Ask user only for decision that is theirs: product trade-off code cannot settle. "Implement it" means spec written and build starts; never skips spec.

Issue labeled `ready-for-agent` is finished spec: build as written. When code shows spec wrong or incomplete, amend spec on issue first (edit body, add comment saying what changed and why), then change code.

## The format

```markdown
## Problem
Who is stuck, and on what.

## Behavior
What each app does, as the user sees it. Name the extension, the Android app, and the server where they differ.

## Acceptance
- [ ] One observable result per line, checkable as pass or fail, with the proof that shows it (test, screenshot, console output).

## Feature triage
The answers from cross-app.md, including the `Entry points:` and `Settings:` lines.

## Out of scope
What a reader might expect and will not get.
```

Acceptance criteria describe behavior seen from outside ("a note longer than the cap is cut on save"), never implementation ("`normalizeBookmark` calls `clip`"). Each must be checkable: reader who never saw code can say whether it holds. Cover empty state, error path, older data where change touches stored data.

Link decision that outlives feature, such as protocol choice, as [ADR](../adr/) from spec. Spec says what must be true; ADR says why this design.

## The loop

1. **Find the spec and claim it.** Read issue and comments, then code it touches. Search pull requests for issue number and keywords (`gh pr list --search "#<n>" --state all`) and check recent commits on `master`: someone may already have built it. When nobody has, comment on issue that you take it. Release claim with comment if you stop. Write spec when missing.
2. **Challenge.** Feature gets `challenge-feature` against spec, as in [Task workflow](workflow.md).
3. **Test first.** Turn acceptance criteria into tests at most direct existing boundary with `tdd` skill. Criterion only browser or emulator can show becomes step list for proof instead.
4. **Build** smallest change that makes every criterion hold.
5. **Prove each criterion.** Run [validation gate](validation.md) and collect one proof per criterion.
6. **Check against the spec.** Read diff once against Acceptance list and Out of scope: criterion with no proof, or behavior in diff no criterion asks for, is a finding. Fix before pull request.
7. **Report by criterion.** Pull request copies Acceptance list and puts proof beside each line, as in [Pull request evidence](validation.md#pull-request-evidence).

Follow up request on open pull request amends spec first: add or change criterion on issue (or in pull request's **Spec** section when no issue), then code and prove like others.

## Splitting work

One feature is one branch and one pull request, even with several steps; push each step to same branch. Split into separate issues only when maintainer wants separate pull requests, using `to-tickets` and blocking links in [Issues](issue-tracker.md). Each ticket then carries own Acceptance list, and parent issue's list is sum of theirs.
