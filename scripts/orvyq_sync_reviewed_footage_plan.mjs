#!/usr/bin/env node
import path from "node:path";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";

const PROJECT_ID = process.argv.find((arg) => arg.startsWith("--project-id="))?.split("=")[1]
  || process.argv[process.argv.indexOf("--project-id") + 1];
if (!PROJECT_ID || PROJECT_ID.startsWith("--")) {
  throw new Error("Usage: node scripts/orvyq_sync_reviewed_footage_plan.mjs --project-id <project-id>");
}

const root = path.join("projects", PROJECT_ID);
const readJson = async (relative) => JSON.parse(await fs.readFile(path.join(root, relative), "utf8"));
const writeJson = async (relative, value) => fs.writeFile(path.join(root, relative), `${JSON.stringify(value, null, 2)}\n`);

function claimNumber(claimId) {
  const match = String(claimId || "").match(/^CLM_(\d{3})_/i);
  return match ? Number(match[1]) : Number.NaN;
}

const [queue, reviews, existingContracts, editorial] = await Promise.all([
  readJson("qa/footage_review_queue.json"),
  readJson("research/visual_asset_reviews.json"),
  readJson("research/footage_use_contracts.json"),
  readJson("config/editorial_asset_plan.json"),
]);

if (queue.project_id !== PROJECT_ID || reviews.project_id !== PROJECT_ID) {
  throw new Error("Project identity mismatch in reviewed-footage inputs");
}
if (!Array.isArray(queue.entries) || queue.entries.length !== 41) {
  throw new Error(`Expected 41 queue entries, found ${queue.entries?.length || 0}`);
}
if (
  reviews.summary?.approved !== 41
  || reviews.summary?.pending_frame_review !== 0
  || reviews.summary?.rejected_from_metadata !== 6
) {
  throw new Error(`Visual review is not final: ${JSON.stringify(reviews.summary || {})}`);
}
if (!Array.isArray(reviews.approved_assets) || reviews.approved_assets.length !== 41) {
  throw new Error("Expected 41 approved visual-review records");
}

const expectedScenes = Array.from({ length: 41 }, (_, index) => `scene_${String(index + 1).padStart(3, "0")}`);
const actualScenes = queue.entries.map((entry) => entry.scene_id);
if (JSON.stringify(actualScenes) !== JSON.stringify(expectedScenes)) {
  throw new Error(`Unexpected scene order: ${actualScenes.join(",")}`);
}

const approvedByScene = new Map(reviews.approved_assets.map((item) => [item.scene_id, item]));
const byPrimaryClaim = new Map();
const normalized = queue.entries.map((entry) => {
  const approved = approvedByScene.get(entry.scene_id);
  if (!approved) throw new Error(`${entry.scene_id}: missing approved review record`);
  if (String(approved.provider_asset_id) !== String(entry.provider_asset_id)) {
    throw new Error(`${entry.scene_id}: provider identity mismatch`);
  }
  if (String(approved.asset_sha256).toLowerCase() !== String(entry.asset_sha256).toLowerCase()) {
    throw new Error(`${entry.scene_id}: footage SHA-256 mismatch`);
  }
  if (String(approved.contact_sheet_sha256).toLowerCase() !== String(entry.contact_sheet_sha256).toLowerCase()) {
    throw new Error(`${entry.scene_id}: contact-sheet SHA-256 mismatch`);
  }
  if (!Array.isArray(entry.approved_uses_if_visually_valid) || entry.approved_uses_if_visually_valid.length < 1) {
    throw new Error(`${entry.scene_id}: missing queue-approved use`);
  }
  const primaryUse = entry.approved_uses_if_visually_valid[0];
  if (!primaryUse.claim_id || !primaryUse.narration_anchor || String(primaryUse.semantic_rationale || "").length < 24) {
    throw new Error(`${entry.scene_id}: incomplete primary approved use`);
  }
  const number = claimNumber(primaryUse.claim_id);
  if (!Number.isInteger(number) || number < 1 || number > 21) {
    throw new Error(`${entry.scene_id}: malformed primary claim id ${primaryUse.claim_id}`);
  }
  const item = { entry, approved, primaryUse };
  byPrimaryClaim.set(primaryUse.claim_id, [...(byPrimaryClaim.get(primaryUse.claim_id) || []), item]);
  return item;
});

const primaryClaimIds = [...byPrimaryClaim.keys()].sort((a, b) => claimNumber(a) - claimNumber(b));
const expectedClaimNumbers = Array.from({ length: 21 }, (_, index) => index + 1);
const primaryClaimNumbers = primaryClaimIds.map(claimNumber);
if (JSON.stringify(primaryClaimNumbers) !== JSON.stringify(expectedClaimNumbers)) {
  throw new Error(`Expected exact claim numbers 1-21, found ${primaryClaimIds.join(",")}`);
}
for (const claimId of primaryClaimIds) {
  const items = byPrimaryClaim.get(claimId);
  items.sort((a, b) => a.entry.scene_id.localeCompare(b.entry.scene_id));
  if (items.length < 1) throw new Error(`${claimId}: no primary footage assets`);
}
if ([...byPrimaryClaim.values()].reduce((sum, items) => sum + items.length, 0) !== 41) {
  throw new Error("Primary claim grouping lost footage records");
}

const motions = ["hold", "push", "pull", "drift_left"];
const contracts = [];
for (const claimId of primaryClaimIds) {
  const items = byPrimaryClaim.get(claimId);
  items.forEach((item, sliceIndex) => {
    const sceneNumber = Number(item.entry.scene_id.split("_")[1]);
    const semanticLink = item.primaryUse.semantic_link || "physical";
    const rationale = item.primaryUse.semantic_rationale;
    const humanContext = /people|person|human|worker|team|developer|researcher|laboratory|analyst|firm/i.test(rationale);
    contracts.push({
      scene_id: item.entry.scene_id,
      claim_id: claimId,
      slice_index: sliceIndex,
      trim_in_ratio: sceneNumber % 2 === 0 ? 0.18 : 0.08,
      motion: motions[(sceneNumber - 1) % motions.length],
      role: semanticLink === "conceptual" ? "governance_context" : (humanContext ? "human_context" : "context"),
      semantic_link: semanticLink,
      semantic_rationale: rationale,
    });
  });
}

const decisions = normalized.map(({ entry, approved }) => ({
  scene_id: entry.scene_id,
  decision: "approve",
  asset_sha256: entry.asset_sha256,
  contact_sheet_sha256: entry.contact_sheet_sha256,
  rationale: approved.decision_rationale,
}));
if (contracts.length !== 41 || decisions.length !== 41) {
  throw new Error("Canonical contract or decision count is not 41");
}
if (decisions.some((decision) => String(decision.rationale || "").length < 24)) {
  throw new Error("At least one approval rationale is too short");
}

await Promise.all([
  writeJson("research/footage_use_contracts.json", {
    schema_version: existingContracts.schema_version || "1.0",
    project_id: PROJECT_ID,
    policy: existingContracts.policy || "Every scene is claim-bound. Generic footage cannot migrate to another claim, and no prior-project asset may be reused.",
    managed_scene_ids: expectedScenes,
    pruned_scene_ids: [],
    assignments: contracts,
  }),
  writeJson("config/footage_review_decisions.json", {
    schema_version: "1.0",
    project_id: PROJECT_ID,
    reviewed_at: reviews.completed_at || new Date().toISOString(),
    review_method: queue.review_method || "four-position claim-specific contact-sheet review",
    decisions,
  }),
  writeJson("config/editorial_asset_plan.json", (() => {
    const cleaned = { ...editorial };
    delete cleaned.approved_pool;
    delete cleaned.candidate_assets;
    delete cleaned.assignments;
    return cleaned;
  })()),
]);

const applyResult = spawnSync(
  process.execPath,
  ["scripts/orvyq_apply_footage_review_decisions.mjs", `--project-id=${PROJECT_ID}`],
  { stdio: "inherit" },
);
if (applyResult.status !== 0) {
  throw new Error(`Canonical footage review applicator failed with status ${applyResult.status}`);
}

const [blueprint, synchronizedContracts, runtime] = await Promise.all([
  readJson("direction/editorial_blueprint.json"),
  readJson("research/footage_use_contracts.json"),
  readJson("assets/footage_acquisition.runtime.json"),
]);
const recordByScene = new Map((runtime.records || []).map((record) => [record.scene_id, record]));
const contractsByClaim = new Map();
for (const contract of synchronizedContracts.assignments || []) {
  contractsByClaim.set(contract.claim_id, [...(contractsByClaim.get(contract.claim_id) || []), contract]);
}
for (const items of contractsByClaim.values()) items.sort((a, b) => Number(a.slice_index) - Number(b.slice_index));
blueprint.motion_hooks = (blueprint.motion_hooks || []).map((hook) => {
  const isFootageHook = hook.visual_role === "cinematic_body_footage" || hook.asset_type === "footage";
  if (!isFootageHook) return hook;
  const choices = contractsByClaim.get(hook.claim_id) || [];
  const contract = choices.find((item) => Number(item.slice_index) === Number(hook.slice_index || 0)) || choices[0];
  if (!contract) return hook;
  const record = recordByScene.get(contract.scene_id);
  if (!record) throw new Error(`${contract.scene_id}: blueprint synchronization has no runtime record`);
  return {
    ...hook,
    asset_id: `local-footage-${contract.scene_id}`,
    asset_path: record.path,
    source_start_seconds: 0,
    semantic_rationale: contract.semantic_rationale,
    semantic_link: contract.semantic_link,
  };
});
await writeJson("direction/editorial_blueprint.json", blueprint);

console.log(JSON.stringify({
  ok: true,
  project_id: PROJECT_ID,
  contracts: contracts.length,
  decisions: decisions.length,
  claims: primaryClaimIds.length,
  per_claim_counts: Object.fromEntries(primaryClaimIds.map((claimId) => [claimId, byPrimaryClaim.get(claimId).length])),
}, null, 2));
