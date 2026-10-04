# StarNet's readiness meter counts its own onboarding calls as user runs

2026-10-03 · Status: root cause confirmed, **not yet filed upstream (parked)** · StarNet `fbddbf992` (v0.12.5)

> Do not publish this writeup before the bug is reported to androoAGI/starnet.

## Question

On a fresh StarNet station where the user had run no tasks, onboarding said:
"still learning you – knows 1/4 areas · **2/4 recent runs**". Where does "2 runs" come from, and is it truthful?

## Hypothesis (suspected cause)

The "recent runs" count includes runs that are not user-initiated.

## Setup

- Source checkout `fbddbf992`, `node sidecar/index.js`, Chrome, Windows 11, Node 22.23.2.
- Workspace deleted first (fresh first run). Quick setup → "while you're away" → "Line up suggestions".

## Method

Read-only trace from the UI string back to its data:
UI text → `/api/nightshift/status` → readiness view → context pack → run store. Then compare against the
actual rows in the fresh workspace's `runs.jsonl`.

## Results

- Text: `frontend/app/nightreport.js:273` (`postureOutlook`) prints `activityCount`, which is
  `nightshiftContextPack().userRunCount` (`sidecar/index.js:6723`).
- `sidecar/index.js:6595` maps run rows to `{ title, ts, streamId, reason }`, which **drops `internal`**.
- `sidecar/contextpack.js:123` filters `!r.internal && …`, which is dead code on this path because the field is always undefined.
- The fresh workspace had exactly 2 run rows, both `internal: true` onboarding model calls with an empty `streamId`.
  Both pass every remaining filter, which reproduces "2/4" exactly.
- Also observed: the count is distinct titles, not runs; the window is 7 days; failed runs count too.

## Interpretation

- **CONFIRMED bug:** the meter claims user activity that never happened. The truthful value is 0/4.
  The run rows *are* marked internal at write time (`runstore.js:272`); the mapping just discards the flag.
- **Fix (not applied):** carry `internal` (and `surface`) through the map at `index.js:6595` so the existing
  guard works, plus an HTTP test. Optionally exclude `reason !== 'done'`.
- **INFERRED:** "1/4 areas" comes from a seed-weight `goals` belief written by quick setup.

## Next step

When un-parked: search upstream issues, then open a one-field PR with a test on a branch cut from
`upstream/feat/harness-backend`. Link the PR here.
