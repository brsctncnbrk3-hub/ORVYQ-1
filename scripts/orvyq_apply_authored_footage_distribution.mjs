#!/usr/bin/env node
import path from "node:path";
import { promises as fs } from "node:fs";

const PROJECT_ID = process.argv.find((arg) => arg.startsWith("--project-id="))?.split("=")[1]
  || process.argv[process.argv.indexOf("--project-id") + 1];
if (!PROJECT_ID || PROJECT_ID.startsWith("--")) {
  throw new Error("Usage: node scripts/orvyq_apply_authored_footage_distribution.mjs --project-id <project-id>");
}

const TARGET_SLICES = {
  CLM_001_SAFETY_FRAMEWORKS: [0],
  CLM_002_COMPETITIVE_INCENTIVE: [0],
  CLM_003_AGENTIC_MISALIGNMENT_TESTS: [0, 3, 5, 7],
  CLM_004_TEST_NOT_DEPLOYMENT: [1, 3, 6],
  CLM_005_2026_MITIGATION_UPDATE: [1],
  CLM_006_INVESTMENT_SCALE: [0, 1, 2, 3, 4],
  CLM_007_FRONTIER_GAP: [0],
  CLM_008_CYBER_EXTORTION: [0, 1, 4, 7],
  CLM_009_AGENTIC_ESPIONAGE: [0, 2],
  CLM_010_BIO_ASL3: [0, 1, 2, 3, 4],
  CLM_011_SYNTHETIC_PERSUASION: [1, 3, 4],
  CLM_012_LABOUR_EXPOSURE: [1, 3, 5],
  CLM_013_MARKET_CONCENTRATION: [1, 3, 4],
  CLM_014_EU_LAYERED_OBLIGATIONS: [0, 2, 4, 6],
  CLM_015_COMPUTE_NOT_ONLY_ROUTE: [0, 1],
  CLM_016_COMPLIANCE_INCUMBENCY: [0, 1],
  CLM_017_OPEN_WEIGHT_TRADEOFF: [1, 3, 5, 7],
  CLM_018_CLOSED_ACCESS_TRADEOFF: [0, 2, 3],
  CLM_019_INDEPENDENT_EVALUATION: [1, 3, 5, 7, 8],
  CLM_020_INCIDENT_REPORTING: [0, 1],
  CLM_021_FINAL_SYNTHESIS: [1, 3, 5, 7, 9, 11, 13, 14, 15, 16],
};

const EXPECTED_SLICE_COUNTS = {
  CLM_001_SAFETY_FRAMEWORKS: 1,
  CLM_002_COMPETITIVE_INCENTIVE: 2,
  CLM_003_AGENTIC_MISALIGNMENT_TESTS: 8,
  CLM_004_TEST_NOT_DEPLOYMENT: 7,
  CLM_005_2026_MITIGATION_UPDATE: 2,
  CLM_006_INVESTMENT_SCALE: 5,
  CLM_007_FRONTIER_GAP: 2,
  CLM_008_CYBER_EXTORTION: 8,
  CLM_009_AGENTIC_ESPIONAGE: 3,
  CLM_010_BIO_ASL3: 5,
  CLM_011_SYNTHETIC_PERSUASION: 5,
  CLM_012_LABOUR_EXPOSURE: 6,
  CLM_013_MARKET_CONCENTRATION: 5,
  CLM_014_EU_LAYERED_OBLIGATIONS: 7,
  CLM_015_COMPUTE_NOT_ONLY_ROUTE: 2,
  CLM_016_COMPLIANCE_INCUMBENCY: 2,
  CLM_017_OPEN_WEIGHT_TRADEOFF: 8,
  CLM_018_CLOSED_ACCESS_TRADEOFF: 4,
  CLM_019_INDEPENDENT_EVALUATION: 9,
  CLM_020_INCIDENT_REPORTING: 2,
  CLM_021_FINAL_SYNTHESIS: 17,
};

const root = path.join("projects", PROJECT_ID);
const planPath = path.join(root, "config", "editorial_asset_plan.json");
const plan = JSON.parse(await fs.readFile(planPath, "utf8"));
if (plan.project_id !== PROJECT_ID || plan.status !== "ready") {
  throw new Error(`Editorial asset plan is not ready for ${PROJECT_ID}`);
}
if (!plan.footage_assignments || typeof plan.footage_assignments !== "object") {
  throw new Error("Editorial asset plan has no footage assignments");
}

const claimIds = Object.keys(TARGET_SLICES);
if (claimIds.length !== 21) throw new Error(`Expected 21 authored claim distributions, found ${claimIds.length}`);
const authored = {};
const totalUseByAsset = new Map();
for (const [asset, count] of Object.entries(plan.hook_preloaded_usage || {})) {
  totalUseByAsset.set(asset, Number(count || 0));
}

const motions = ["hold", "push", "pull", "drift_left"];
const trimVariants = [null, 0.32, 0.05, 0.24, 0.14];

for (const claimId of claimIds) {
  const current = plan.footage_assignments[claimId];
  if (!current || typeof current !== "object") throw new Error(`${claimId}: missing source assignments`);
  const assets = Object.entries(current)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, assignment]) => ({ ...assignment }));
  if (!assets.length) throw new Error(`${claimId}: no approved claim-bound assets`);

  const targetSlices = TARGET_SLICES[claimId];
  const sliceCount = EXPECTED_SLICE_COUNTS[claimId];
  if (!Number.isInteger(sliceCount) || targetSlices.some((slice) => !Number.isInteger(slice) || slice < 0 || slice >= sliceCount)) {
    throw new Error(`${claimId}: authored slice is outside the diagnosed ${sliceCount}-slice window`);
  }
  if (new Set(targetSlices).size !== targetSlices.length) throw new Error(`${claimId}: duplicate target slice`);

  const localUses = new Map();
  authored[claimId] = {};
  for (let index = 0; index < targetSlices.length; index += 1) {
    let sourceIndex = index;
    if (sourceIndex >= assets.length) {
      const reusable = assets
        .map((assignment, candidateIndex) => ({
          assignment,
          candidateIndex,
          localUse: localUses.get(assignment.asset) || 0,
          hookUse: Number((plan.hook_preloaded_usage || {})[assignment.asset] || 0),
        }))
        .sort((a, b) => (a.hookUse - b.hookUse) || (a.localUse - b.localUse) || (a.candidateIndex - b.candidateIndex));
      sourceIndex = reusable[0].candidateIndex;
    }

    const source = assets[sourceIndex];
    const asset = source.asset;
    if (!asset) throw new Error(`${claimId}: source assignment ${sourceIndex} has no asset`);
    const previousLocalUses = localUses.get(asset) || 0;
    const previousTotalUses = totalUseByAsset.get(asset) || 0;
    localUses.set(asset, previousLocalUses + 1);
    totalUseByAsset.set(asset, previousTotalUses + 1);

    const targetSlice = targetSlices[index];
    const trimVariant = trimVariants[previousLocalUses % trimVariants.length];
    const assignment = {
      ...source,
      motion: motions[(targetSlice + index) % motions.length],
      semantic_rationale: source.semantic_rationale || source.reuse_reason || `Claim-bound contextual footage for ${claimId}.`,
    };
    if (trimVariant !== null) assignment.trim_in_ratio = trimVariant;
    if (previousTotalUses > 0 || previousLocalUses > 0) {
      assignment.reuse_reason = `Intentional spaced reuse within ${claimId}: the same approved claim-bound clip is re-entered at slice ${targetSlice} with a different trim and motion to break a long evidence run without introducing unreviewed or semantically weaker stock.`;
    } else {
      delete assignment.reuse_reason;
    }
    authored[claimId][String(targetSlice)] = assignment;
  }
}

const totalAssignments = Object.values(authored).reduce((sum, claim) => sum + Object.keys(claim).length, 0);
if (totalAssignments !== 68) throw new Error(`Expected 68 authored footage slices, found ${totalAssignments}`);

plan.footage_assignments = authored;
plan.slice_count_overrides = {};
plan.authored_distribution = {
  schema_version: "1.0",
  source: "full_production_coverage_diagnostic",
  diagnosed_shot_count: 127,
  diagnosed_runtime_seconds: 829.289,
  target_footage_slices: 68,
  predicted_footage_seconds: 504.769,
  predicted_footage_ratio: 0.6086768304,
  predicted_evidence_ratio: 0.3889114651,
  predicted_graphic_ratio: 0.0024117045,
  predicted_max_uninterrupted_evidence_seconds: 14.74,
  editorial_pause_footage_claims: [
    "CLM_003_AGENTIC_MISALIGNMENT_TESTS",
    "CLM_005_2026_MITIGATION_UPDATE",
    "CLM_008_CYBER_EXTORTION",
    "CLM_010_BIO_ASL3",
    "CLM_014_EU_LAYERED_OBLIGATIONS",
    "CLM_017_OPEN_WEIGHT_TRADEOFF",
    "CLM_019_INDEPENDENT_EVALUATION",
    "CLM_021_FINAL_SYNTHESIS"
  ],
  quality_policy: "All placements are claim-bound to the existing reviewed pool. Reuse is explicit, spaced, and differentiated by trim and motion; no unreviewed footage or automatic generic backfill is introduced."
};
plan.notes = "Authored against the exact 127-shot coverage diagnostic: 68 contextual-footage slices target 60.87% footage, keep evidence above 20%, keep graphics below 15%, cap uninterrupted evidence at 14.74 seconds, and land every editorial pause on footage.";

await fs.writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
console.log(JSON.stringify({
  ok: true,
  project_id: PROJECT_ID,
  claim_count: claimIds.length,
  footage_assignment_count: totalAssignments,
  predicted_footage_ratio: plan.authored_distribution.predicted_footage_ratio,
  predicted_max_uninterrupted_evidence_seconds: plan.authored_distribution.predicted_max_uninterrupted_evidence_seconds,
}, null, 2));
