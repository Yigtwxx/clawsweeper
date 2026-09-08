// Compiled before/after proof for OpenClaw process-tree termination on worker signals.
//
// Both arms start the real compiled OpenClaw process worker with a fake `openclaw`
// binary that spawns a grandchild, ignores SIGTERM, and never exits. The driver then
// sends SIGTERM to the worker itself, the signal a job cancellation or an outer
// deadline delivers, and records whether the child and grandchild are still alive
// three seconds later. The baseline arm compiles src/openclaw-process-worker.ts from
// the base commit (default HEAD~1); the candidate arm uses the current dist/.
//
// POSIX only: the worker's process-group handling has no Windows equivalent here.
//
// Usage: node docs/proof/openclaw-worker-signal-termination/run-proof.mjs [--base <rev>]
//        [--out <dir>] [--baseline-dist <dir>]
import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform === "win32") {
  console.error("This proof uses POSIX signals and process groups; run it on Linux or macOS.");
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
const WORKER = "src/openclaw-process-worker.ts";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const baseRev = option("--base", "HEAD~1");
const outDir = resolve(repoRoot, option("--out", ".artifacts/openclaw-worker-signal-termination"));
const providedBaselineDist = option("--baseline-dist", "");
mkdirSync(outDir, { recursive: true });

const git = (...gitArgs) =>
  execFileSync("git", gitArgs, { cwd: repoRoot, encoding: "utf8" }).trim();

function compileBaselineDist() {
  const baselineDist = join(outDir, "baseline-dist");
  const baseSha = git("rev-parse", baseRev);
  const baselineSource = git("show", `${baseSha}:${WORKER}`);
  const workerPath = join(repoRoot, WORKER);
  const headSource = readFileSync(workerPath, "utf8");
  writeFileSync(join(outDir, "baseline-worker.ts"), baselineSource);
  try {
    writeFileSync(workerPath, baselineSource);
    execFileSync(
      process.execPath,
      [
        join(repoRoot, "node_modules", "typescript", "bin", "tsc"),
        "-p",
        "tsconfig.json",
        "--outDir",
        baselineDist,
      ],
      { cwd: repoRoot, stdio: "inherit" },
    );
  } finally {
    writeFileSync(workerPath, headSource);
  }
  if (readFileSync(workerPath, "utf8") !== headSource) {
    throw new Error(`${WORKER} was not restored after the baseline build`);
  }
  return { baselineDist, baseSha };
}

const hangingOpenclaw = `#!/usr/bin/env node
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  stdio: "ignore",
});
process.on("SIGTERM", () => {});
fs.writeFileSync(
  process.env.OPENCLAW_PROOF_PID_PATH,
  JSON.stringify({ child: process.pid, grandchild: grandchild.pid }),
);
setInterval(() => {}, 1000);
`;

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

async function runArm(arm) {
  const root = mkdtempSync(join(tmpdir(), "clawsweeper-openclaw-signal-proof-"));
  const pidPath = join(root, "openclaw.pid");
  const binary = join(root, "hanging-openclaw");
  writeFileSync(binary, hangingOpenclaw);
  chmodSync(binary, 0o755);
  const optionsPath = join(root, "worker-options.json");
  const resultPath = join(root, "result.json");
  writeFileSync(
    optionsPath,
    JSON.stringify({
      args: [],
      command: binary,
      timeoutMs: 60_000,
      resultPath,
      stdoutPath: join(root, "stdout.log"),
      stderrPath: join(root, "stderr.log"),
      tailBytes: 4096,
      maxOutputFileBytes: 65_536,
    }),
  );
  const worker = spawn(
    process.execPath,
    [join(arm.dist, "openclaw-process-worker.js"), optionsPath],
    {
      cwd: root,
      env: { ...process.env, OPENCLAW_PROOF_PID_PATH: pidPath },
      stdio: "ignore",
    },
  );
  const workerExit = new Promise((resolveExit) =>
    worker.once("exit", (code, signal) => resolveExit({ code, signal })),
  );
  let pids;
  try {
    const startDeadline = Date.now() + 10_000;
    while (!existsSync(pidPath)) {
      if (Date.now() > startDeadline) throw new Error("hanging OpenClaw child never started");
      await sleep(50);
    }
    pids = JSON.parse(readFileSync(pidPath, "utf8"));
    const signalledAt = Date.now();
    worker.kill("SIGTERM");
    const exit = await workerExit;
    const workerExitMs = Date.now() - signalledAt;
    const reapDeadline = signalledAt + 3_000;
    while (Date.now() < reapDeadline && [pids.child, pids.grandchild].some(processAlive)) {
      await sleep(50);
    }
    const treeGoneMs = Date.now() - signalledAt;
    const childAlive = processAlive(pids.child);
    const grandchildAlive = processAlive(pids.grandchild);
    const result = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, "utf8")) : null;
    return {
      arm: arm.name,
      workerExit: exit,
      workerExitMs,
      childAliveAfterWait: childAlive,
      grandchildAliveAfterWait: grandchildAlive,
      treeGoneMs: childAlive || grandchildAlive ? null : treeGoneMs,
      resultSignal: result ? (result.signal ?? null) : "no result file",
    };
  } finally {
    for (const pid of [pids?.child, pids?.grandchild]) {
      if (pid) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {}
      }
    }
    rmSync(root, { recursive: true, force: true });
  }
}

const head = git("rev-parse", "HEAD");
const candidateDist = join(repoRoot, "dist");
if (!existsSync(join(candidateDist, "openclaw-process-worker.js"))) {
  throw new Error("dist/openclaw-process-worker.js is missing; run pnpm run build first");
}
const baseline = providedBaselineDist
  ? { baselineDist: resolve(repoRoot, providedBaselineDist), baseSha: "provided" }
  : compileBaselineDist();

const results = [];
for (const arm of [
  {
    name: `baseline (${WORKER} from ${baseline.baseSha.slice(0, 10)})`,
    dist: baseline.baselineDist,
  },
  { name: `candidate (${head.slice(0, 10)})`, dist: candidateDist },
]) {
  results.push(await runArm(arm));
}
const [baselineResult, candidateResult] = results;
const pass =
  baselineResult.workerExit.signal === "SIGTERM" &&
  baselineResult.childAliveAfterWait === true &&
  baselineResult.grandchildAliveAfterWait === true &&
  baselineResult.resultSignal === "no result file" &&
  candidateResult.workerExit.code === 0 &&
  candidateResult.childAliveAfterWait === false &&
  candidateResult.grandchildAliveAfterWait === false &&
  candidateResult.resultSignal === "SIGKILL";
const summary = {
  head,
  base: baseline.baseSha,
  node: process.version,
  platform: `${process.platform} ${process.arch}`,
  results,
  pass,
};
writeFileSync(join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
console.log(`PROOF_RESULT=${pass ? "PASS" : "FAIL"}`);
process.exit(pass ? 0 : 1);
