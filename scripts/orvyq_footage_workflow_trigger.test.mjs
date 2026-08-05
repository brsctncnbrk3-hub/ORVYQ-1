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

test("footage preparation rebuilds the canonical shot baseline before applying contracts", async () => {
  const workflow = await readFile(
    path.join(REPO_ROOT, ".github", "workflows", "orvyq-footage-acquisition.yml"),
    "utf8",
  );
  const buildIndex = workflow.indexOf("Rebuild the canonical shot baseline before footage reconciliation");
  const reconcileIndex = workflow.indexOf("Apply claim-bound footage use contracts");

  assert.ok(buildIndex >= 0, "canonical full-production rebuild step is missing");
  assert.ok(reconcileIndex > buildIndex, "footage contracts must not materialize against a stale committed blueprint");
  assert.match(workflow, /node scripts\/orvyq_full_production_plan\.mjs --project-id="\$PROJECT_ID"/);
});
