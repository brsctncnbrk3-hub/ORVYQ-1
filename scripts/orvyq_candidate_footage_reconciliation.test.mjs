import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const workflow = fs.readFileSync(
  new URL("../.github/workflows/orvyq-candidate-validation.yml", import.meta.url),
  "utf8",
);

test("Candidate Validation reconciles claim-bound footage after regenerating shots and before edit-plan validation", () => {
  const buildIndex = workflow.indexOf("Build the canonical full production shot list from real data");
  const reconcileIndex = workflow.indexOf("Reconcile claim-bound footage contracts after shot generation");
  const editIndex = workflow.indexOf("Build the canonical candidate edit plan");

  assert.ok(buildIndex >= 0, "full-production generation step is missing");
  assert.ok(reconcileIndex > buildIndex, "footage contracts must be reconciled after full-production generation");
  assert.ok(editIndex > reconcileIndex, "edit-plan validation must consume the reconciled canonical blueprint");
  assert.match(
    workflow,
    /node scripts\/orvyq_apply_footage_use_contracts\.mjs --project-id="\$PROJECT_ID"/,
  );
});
