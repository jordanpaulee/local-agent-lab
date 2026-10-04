# A Windows-only StarNet test failure was a libuv bug in Node 22.12–22.16, not a StarNet bug

2026-10-03 · Status: concluded (not filed, by design) · StarNet `fbddbf992` · Windows 11 26200

## Question

`test/discovery-documents.test.js` failed on a fresh Windows checkout of StarNet (952/953 in `test:fast`).
Is this a StarNet bug worth reporting upstream?

## Hypothesis (suspected cause)

The failing guard in `sidecar/discovery-documents.js:59` compares `lstat(path).dev` against
`(await open(path)).stat().dev` to detect a file being swapped between check and open (a TOCTOU guard). If
Windows reports `dev` differently for path-based and handle-based stat, the guard rejects every file.

## Setup

- StarNet `fbddbf992`, Windows 11 26200 x64, NTFS volumes C:, D:, E:.
- System Node 22.16.0 (libuv 1.49.2). Comparison builds through `npx -y node@N`.
- Probe: [probe-dev.js](probe-dev.js) prints `dev`/`ino` from every stat variant for one temp file.

## Method

1. Rule out checkout noise: rerun with `core.autocrlf=false`, leaving only this one failure.
2. Run the probe across Node 20 / 22.16 / 22.23 / 24 and across drives.
3. Bisect bundled libuv versions using Node's `deps/uv` at release tags, then read libuv's changelog and source.
4. Search StarNet for other `dev`/`ino` identity comparisons ("siblings").
5. Search StarNet issues, PRs and docs for prior reports.

## Results

| Node | libuv | path-based `dev` (lstat/stat, sync/promise/bigint) | handle `fstat` dev |
|---|---|---|---|
| 22.16.0 | 1.49.2 | **0** | volume serial |
| 20.20.2 | 1.46.0 | volume serial | volume serial |
| 22.23.3 | 1.51.0 | volume serial | volume serial |
| 24.21.0 | 1.52.1 | volume serial | volume serial |

- `ino` matched in every run. Every NTFS volume was affected on 22.16, not only C:.
- Cause: libuv 1.49.0 added a Windows fast path-stat API (`4e310d0f`, #4327) that stores the volume serial with a
  different width than the handle path. libuv PR #4698 fixed it in 1.51.0.
- Affected Node lines: 22.12–22.16 and 23.x (libuv 1.49.x, confirmed from tags). 24.0–24.1 (libuv 1.50.0) is inferred affected from source, not run.
- Only one call site in StarNet compares `dev`. No prior report exists upstream.
- After upgrading system Node to 22.23.2, `npm ci` and `test:fast` passed 953/953.

## Interpretation

- **Not a StarNet bug.** The desktop app bundles Node 22.23.2 and CI uses the latest Node 22, so shipped users
  and CI are unaffected. Only source checkouts on an older Node 22 hit it.
- The guard's intent is sound. On the affected runtimes it fails closed: it rejects every file rather than letting a swapped file through.
- Same symptom reported downstream in other Node apps (chatboxai/chatbox#3957, affaan-m/ECC#3041).
- **Low-value follow-ups, deliberately not filed:** `engines: ">=18"` admits affected versions, and the
  guard skips silently, so a platform mismatch shows up as "no recent evidence" instead of an error.

General lesson: when comparing file identity across stat calls on Windows, compare `ino` (plus size/mtime), or
compare `dev` only when both are non-zero.

## Next step

None. This is closed as a local environment issue. It's kept here as a worked example of ruling out an
upstream report before filing one.
