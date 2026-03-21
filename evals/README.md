# Weave Evals

Phase 1 ships a repo-native, deterministic eval harness for prompt and agent contract coverage.

## What Phase 1 Covers

- Deterministic prompt-contract checks only
- Built-in agents only: Loom, Tapestry, Pattern, Thread, Spindle, Weft, Warp
- Local and CI-safe execution with no provider credentials
- Machine-readable run artifacts under `.weave/evals/`

## What Phase 1 Does Not Cover

- No live provider calls
- No CI baseline gating yet
- No trajectory or multi-step replay evals yet
- No Shuttle coverage in the initial suite

Shuttle is intentionally deferred because its behavior is category/config driven, while Phase 1 focuses on the highest-value prompt contracts first.

## Layout

- `evals/suites/*.jsonc` - suite manifests
- `evals/cases/**/*.jsonc` - committed eval cases
- `.weave/evals/runs/*.json` - local run artifacts
- `.weave/evals/latest.json` - latest run convenience copy

## Running Evals

```bash
bun run eval --suite phase1-core
```

Useful filters:

```bash
bun run eval --suite phase1-core --agent loom
bun run eval --suite phase1-core --case loom-default-contract
bun run eval --suite phase1-core --tag composer --json
bun run eval --suite phase1-core --output /tmp/weave-evals.json
```

Filter precedence and behavior:

- `--suite` selects the manifest; defaults to `phase1-core`
- `--case` narrows within the selected suite
- `--agent` and `--tag` are intersecting filters
- `--output` overrides the primary artifact path
- `--json` changes stdout formatting only; artifacts are still written

Exit codes:

- `0` all selected cases passed
- `1` one or more selected cases failed
- `2` usage or selector error
- `3` schema/load/config error
- `4` unexpected internal runner error

## Writing Cases

Use structural checks first:

- XML section boundaries
- ordered anchors
- tool policy expectations
- minimum length or intent markers

Prefer stable contract anchors over brittle paragraph equality. If a future prompt needs an eval-only boundary, use:

```html
<!-- weave-eval:anchor-name -->
```

Only use exact phrase checks when wording itself is normative.

## Coverage

Phase 1 coverage threshold for `src/features/evals/**` is 85% for lines and functions, excluding fixtures.

```bash
bun run eval:coverage
```

## CI Strategy

- Fast deterministic suites belong in PR/main CI
- Provider-backed judge runs belong in dedicated manual or scheduled workflows later
- Expensive eval classes should not become accidental always-on blockers

## Future Phases

- `target.kind` is ready for custom-agent, single-turn, and trajectory targets
- `executor.kind` is ready for `model-response` and `trajectory-run`
- `evaluator.kind` is ready for `llm-judge`, `baseline-diff`, and `trajectory-assertion`
- Promptfoo, if adopted later, should be an adapter behind executor/judge layers rather than the canonical schema owner
- Provider-backed evals must use env-only secrets and must never persist raw tokens, keys, or auth headers in artifacts
