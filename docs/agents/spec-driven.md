# Spec driven development

The spec is the contract. A change is done when every acceptance criterion in it has proof, and the code does nothing the spec does not ask for. The spec lives in one place, the GitHub issue ([Issues](issue-tracker.md)), and the pull request points back to it.

## What counts as the spec

| Change | Spec |
| --- | --- |
| Feature: new behavior, data, setting, sync, or link handling | An issue in the format below |
| Fix | The bug report: its steps reproduce the bug and its expected result is the criterion |
| Refactor, docs, tooling | One sentence in **What and why** of the pull request, naming what must stay true |

A feature without an issue gets one before the first edit. Write it from the request and the code with the `to-spec` skill (no interview) or by hand in the format below, publish it with `gh issue create`, and go on. Ask the user only for a decision that is theirs to make: a product trade-off the code cannot settle. "Implement it" means the spec is written and the build starts; it never skips the spec.

An issue labeled `ready-for-agent` is a finished spec: build it as written. When the code shows the spec is wrong or incomplete, amend the spec on the issue first (edit the body, add a comment saying what changed and why), then change the code.

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

Acceptance criteria describe behavior seen from outside ("a note longer than the cap is cut on save"), never the implementation ("`normalizeBookmark` calls `clip`"). Each one must be checkable: a reader who has never seen the code can say whether it holds. Cover the empty state, the error path, and older data where the change touches stored data.

Link a decision that outlives the feature, such as a protocol choice, as an [ADR](../adr/) from the spec. The spec says what must be true; the ADR says why this design.

## The loop

1. **Find the spec and claim it.** Read the issue and its comments, then the code it touches. Search pull requests for the issue number and its keywords (`gh pr list --search "#<n>" --state all`) and check recent commits on `master`: someone may already have built it. When nobody has, comment on the issue that you are taking it. Release the claim with a comment if you stop. Write the spec when it is missing.
2. **Challenge.** A feature gets `challenge-feature` against the spec, as in [Task workflow](workflow.md).
3. **Test first.** Turn the acceptance criteria into tests at the most direct existing boundary with the `tdd` skill. A criterion that only a browser or an emulator can show becomes a step list for the proof instead.
4. **Build** the smallest change that makes every criterion hold.
5. **Prove each criterion.** Run the [validation gate](validation.md) and collect one piece of proof per criterion.
6. **Check against the spec.** Read the diff once against the Acceptance list and Out of scope: a criterion with no proof, or behavior in the diff that no criterion asks for, is a finding. Fix it before the pull request.
7. **Report by criterion.** The pull request copies the Acceptance list and puts the proof beside each line, as in [Pull request evidence](validation.md#pull-request-evidence).

A follow up request on an open pull request amends the spec first: add or change the criterion on the issue (or in the pull request's **Spec** section when there is no issue), then code it and prove it like the others.

## Splitting work

One feature is one branch and one pull request, even when it has several steps; push each step to the same branch. Split it into separate issues only when the maintainer wants separate pull requests, using `to-tickets` and the blocking links in [Issues](issue-tracker.md). Each ticket then carries its own Acceptance list, and the parent issue's list is the sum of theirs.
