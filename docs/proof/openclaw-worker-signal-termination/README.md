# OpenClaw worker signal termination proof

The OpenClaw process worker starts the `openclaw` CLI in its own process group
so that its own timeout can stop the whole tree. A signal delivered to the
worker itself, which is what a job cancellation, a runner shutdown, or the outer
`spawnSync` deadline sends, never reached that group: the worker exited and
the CLI and its descendants kept running. The Codex process worker already
forwards `SIGINT`, `SIGTERM`, and `SIGHUP` to its process tree; this proof
shows the OpenClaw worker now does the same.

[`run-proof.mjs`](run-proof.mjs) starts the compiled worker with a fake
`openclaw` binary that spawns a grandchild, ignores `SIGTERM`, and never exits,
then sends `SIGTERM` to the worker and records whether the child and grandchild
are still alive three seconds later. The baseline arm compiles
`src/openclaw-process-worker.ts` from the base commit into a separate `dist`;
the candidate arm uses the current build. No model inference, network access,
or credential is involved. The driver is POSIX only.

```sh
pnpm run build
node docs/proof/openclaw-worker-signal-termination/run-proof.mjs --out .artifacts/openclaw-worker-signal-termination
```

`--base <rev>` selects the baseline commit (default `HEAD~1`); `--baseline-dist`
reuses a previously compiled baseline. The driver writes `summary.json` with
the worker exit status, the elapsed time until the worker exited, the elapsed
time until the tree was gone, and the recorded result signal for each arm, and
exits non-zero unless the baseline leaves both processes alive and the
candidate stops both.

Expected result: the baseline worker dies from `SIGTERM` without writing a
result, and both the child and the grandchild survive the three-second wait;
the candidate worker forwards the signal, escalates to `SIGKILL` after one
second because the child ignores `SIGTERM`, records `signal: "SIGKILL"` in its
result file, exits with code 0, and leaves no surviving process.

Limits: controlled compiled run with a fake CLI; it does not claim a specific
production cancellation left an orphaned `openclaw` process. Windows keeps the
existing `taskkill /t` path and is not exercised. OpenClaw Bay is unaffected:
no lifecycle, queue, telemetry, or dashboard contract changes.
