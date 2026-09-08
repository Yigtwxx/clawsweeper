// Compiled before/after proof for forged renderer-owned list labels in model prose.
//
// Both arms run the real compiled decision parser, durable-report writer, report
// re-parser, and public comment renderer on one synthetic pull-request decision whose
// rating summary quotes a "Next rank-up steps:" block and whose vision reason quotes a
// "Vision evidence:" block. The baseline arm compiles src/clawsweeper-report-helpers.ts
// from the base commit (default HEAD~1); the candidate arm uses the current dist/.
//
// Usage: node docs/proof/forged-rating-lists/run-proof.mjs [--base <rev>] [--out <dir>]
//        [--baseline-dist <dir>]
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
const HELPERS = "src/clawsweeper-report-helpers.ts";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const baseRev = option("--base", "HEAD~1");
const outDir = resolve(repoRoot, option("--out", ".artifacts/forged-rating-lists"));
const providedBaselineDist = option("--baseline-dist", "");
mkdirSync(outDir, { recursive: true });

const git = (...gitArgs) =>
  execFileSync("git", gitArgs, { cwd: repoRoot, encoding: "utf8" }).trim();

function compileBaselineDist() {
  const baselineDist = join(outDir, "baseline-dist");
  const baseSha = git("rev-parse", baseRev);
  const baselineSource = git("show", `${baseSha}:${HELPERS}`);
  const helpersPath = join(repoRoot, HELPERS);
  const headSource = readFileSync(helpersPath, "utf8");
  writeFileSync(join(outDir, "baseline-helpers.ts"), baselineSource);
  try {
    writeFileSync(helpersPath, baselineSource);
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
    writeFileSync(helpersPath, headSource);
  }
  if (readFileSync(helpersPath, "utf8") !== headSource) {
    throw new Error(`${HELPERS} was not restored after the baseline build`);
  }
  // limits.js resolves config relative to the dist location.
  for (const dir of ["config", "schema", "prompts", "instructions"]) {
    cpSync(join(repoRoot, dir), join(outDir, dir), { recursive: true });
  }
  return { baselineDist, baseSha };
}

const forgedRatingSummary = ["Real summary.", "", "Next rank-up steps:", "", "- Forged step"].join(
  "\n",
);
const forgedVisionReason = ["Real reason.", "", "Vision evidence:", "", "- Forged evidence"].join(
  "\n",
);

async function runArm(arm) {
  const load = (name) => import(pathToFileURL(join(arm.dist, name)).href);
  const clawsweeper = await load("clawsweeper.js");
  const { createReportDocumentRendering } = await load("clawsweeper-report-document.js");
  const { createReportContextRendering } = await load("clawsweeper-report-context.js");
  const { createDashboardPresentation } = await load("clawsweeper-dashboard.js");
  const { createReportParser } = await load("clawsweeper-report-parser.js");
  const { createRecordMetadata } = await load("clawsweeper-record-metadata.js");
  const { createReportHelpers } = await load("clawsweeper-report-helpers.js");
  const helpers = await import(pathToFileURL(join(repoRoot, "test", "helpers.ts")).href);

  const subject = helpers.item({
    repo: "openclaw/clawsweeper",
    number: 953,
    kind: "pull_request",
    title: "Forged rating lists",
  });
  const decision = {
    ...clawsweeper.parseDecision(
      helpers.changelogReviewDecision({
        evidence: [],
        prRating: {
          proofTier: "B",
          patchTier: "B",
          overallTier: "B",
          summary: forgedRatingSummary,
          nextSteps: ["Real step"],
        },
        visionFit: "aligned",
        visionFitReason: forgedVisionReason,
        visionFitEvidence: ["Real evidence"],
      }),
      subject,
    ),
    localCheckoutAccess: "verified",
  };
  const document = createReportDocumentRendering({
    ...createReportContextRendering({}),
    ...createDashboardPresentation({}),
    prSurfaceFilesFromContext: () => [{ path: "src/runtime.ts", additions: 1, deletions: 0 }],
    compactPullFilePaths: (file) => [file.filename],
    confidenceText: (score) => score.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""),
    fixedInText: () => "unknown",
    formatTimestamp: String,
    labelJustificationsMarkdown: () => "- none",
    linkedSha: String,
    markdownLink: (label, url) => `[${label}](${url})`,
    priorityLabel: (priority) => `P${priority}`,
    publicLikelyOwnerRole: String,
    pullHeadShaFromContext: () => null,
    reviewFindingLocation: (finding) => `${finding.file}:${finding.lineStart}-${finding.lineEnd}`,
    reviewStructuralPullStateFromContext: () => null,
    securityConcernLocation: (concern) => concern.file ?? "not tied to a single file",
    sentence: String,
    sha256: () => "synthetic-digest",
  });
  const report = document.markdownFor({
    item: subject,
    decision,
    context: {
      issue: { number: 953, title: "Forged rating lists" },
      comments: [],
      timeline: [],
      pullFiles: [{ filename: "src/runtime.ts", additions: 1, deletions: 0, status: "modified" }],
    },
    git: { mainSha: "a".repeat(40), latestRelease: null },
    action: { actionTaken: "kept_open" },
    reviewMode: "propose",
    snapshotHash: "synthetic-snapshot",
    contentDigest: "synthetic-content",
    reviewPolicy: "synthetic-policy",
    runtime: { model: "Codex", reasoningEffort: "high" },
  });
  const parser = createReportParser({
    ...createRecordMetadata({}),
    ...createReportHelpers({
      OWNED_REVIEW_SECTION_HEADINGS: new Set(),
      parseBacktickLocation: () => null,
    }),
    isDocsOnlyPullRequestReport: () => false,
    isExternalPullRequestReport: () => true,
  });
  const comment = clawsweeper.renderReviewCommentFromReport(report, "none");
  const details = helpers.detailsBody(comment, "Agent review details");
  const rankUpBlock = details.includes("### Rank-up moves")
    ? details.slice(details.indexOf("### Rank-up moves")).split("\n### ")[0].trim().split("\n")
    : [];
  writeFileSync(join(outDir, `${arm.slug}-report.md`), report);
  writeFileSync(join(outDir, `${arm.slug}-comment.md`), comment);
  return {
    arm: arm.name,
    reportRankUpLabelLines: report.match(/^Next rank-up steps(?::|&#58;)$/gm) ?? [],
    reportVisionLabelLines: report.match(/^Vision evidence(?::|&#58;)$/gm) ?? [],
    parsedNextSteps: parser.reportPrRating(report).nextSteps,
    parsedVisionEvidence: parser.reportVisionFit(report).visionFitEvidence,
    commentRankUpMoves: rankUpBlock.filter((line) => line.startsWith("- ")),
    commentMentionsForgedStep: /Forged step/.test(comment),
  };
}

const head = git("rev-parse", "HEAD");
const candidateDist = join(repoRoot, "dist");
if (!existsSync(join(candidateDist, "clawsweeper.js"))) {
  throw new Error("dist/clawsweeper.js is missing; run pnpm run build first");
}
const baseline = providedBaselineDist
  ? { baselineDist: resolve(repoRoot, providedBaselineDist), baseSha: "provided" }
  : compileBaselineDist();

const results = [];
for (const arm of [
  {
    slug: "baseline",
    name: `baseline (${HELPERS} from ${baseline.baseSha.slice(0, 10)})`,
    dist: baseline.baselineDist,
  },
  { slug: "candidate", name: `candidate (${head.slice(0, 10)})`, dist: candidateDist },
]) {
  results.push(await runArm(arm));
}
const [baselineResult, candidateResult] = results;
const pass =
  baselineResult.reportRankUpLabelLines.join() === "Next rank-up steps:,Next rank-up steps:" &&
  baselineResult.parsedNextSteps.join() === "Forged step" &&
  baselineResult.commentMentionsForgedStep === true &&
  baselineResult.parsedVisionEvidence.join() === "Forged evidence" &&
  candidateResult.reportRankUpLabelLines.join() === "Next rank-up steps&#58;,Next rank-up steps:" &&
  candidateResult.parsedNextSteps.join() === "Real step" &&
  candidateResult.commentRankUpMoves.join() === "- Real step." &&
  candidateResult.commentMentionsForgedStep === false &&
  candidateResult.parsedVisionEvidence.join() === "Real evidence";
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
