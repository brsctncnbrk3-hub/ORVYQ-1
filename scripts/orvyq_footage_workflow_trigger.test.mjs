import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT } from "./lib/fs-utils.mjs";

test("footage use-contract overrides trigger, resolve, persist and upload through the generic workflow", async () => {
  const workflow = await readFile(
    path.join(REPO_ROOT, ".github", "workflows", "orvyq-footage-acquisition.yml"),
    "utf8",
  );
  const token = "footage_use_contract_overrides.json";
  const occurrences = workflow.split(token).length - 1;
  assert.ok(
    occurrences >= 4,
    `Expected ${token} in push paths, changed-input resolution, commit staging and diagnostics; found ${occurrences}`,
  );
  assert.match(workflow, /projects\/\*\/research\/footage_use_contract_overrides\.json/);
  assert.match(workflow, /footage_use_contracts\|footage_use_contract_overrides\|footage_visual_decisions/);
  assert.match(workflow, /test ! -f .*footage_use_contract_overrides\.json/);
});

test("footage preparation resolves pauses and rebuilds the canonical shot baseline before applying contracts", async () => {
  const workflow = await readFile(
    path.join(REPO_ROOT, ".github", "workflows", "orvyq-footage-acquisition.yml"),
    "utf8",
  );
  const speechQaIndex = workflow.indexOf("Run full-duration narration QA for canonical alignment");
  const alignmentIndex = workflow.indexOf("Build canonical narration alignment before pause resolution");
  const pauseIndex = workflow.indexOf("Resolve the canonical editorial pause plan before shot generation");
  const buildIndex = workflow.indexOf("Rebuild the canonical shot baseline before footage reconciliation");
  const reconcileIndex = workflow.indexOf("Apply claim-bound footage use contracts");

  assert.ok(speechQaIndex >= 0, "full-duration narration QA step is missing");
  assert.ok(alignmentIndex > speechQaIndex, "canonical alignment must use the validated narration result");
  assert.ok(pauseIndex > alignmentIndex, "pause resolution must use the fresh canonical narration alignment");
  assert.ok(pauseIndex >= 0, "canonical pause-resolution step is missing");
  assert.ok(buildIndex > pauseIndex, "shot generation must use the resolved canonical pause plan");
  assert.ok(buildIndex >= 0, "canonical full-production rebuild step is missing");
  assert.ok(reconcileIndex > buildIndex, "footage contracts must not materialize against a stale committed blueprint");
  assert.match(workflow, /node scripts\/orvyq_narration_alignment\.mjs --project-id="\$PROJECT_ID"/);
  assert.match(workflow, /node scripts\/orvyq_resolve_pauses\.mjs --project-id="\$PROJECT_ID"/);
  assert.match(workflow, /node scripts\/orvyq_full_production_plan\.mjs --project-id="\$PROJECT_ID"/);
});

test("shared footage workflow changes target the sole active candidate instead of becoming unresolved", async () => {
  const workflow = await readFile(
    path.join(REPO_ROOT, ".github", "workflows", "orvyq-footage-acquisition.yml"),
    "utf8",
  );

  assert.match(workflow, /config\/candidate_validation_request\.json/);
  assert.match(workflow, /select\(\.status == "requested"\) \| \.project_id/);
  assert.match(workflow, /if \[ "\$\{#ACTIVE_PROJECTS\[@\]\}" -eq 1 \]/);
});
