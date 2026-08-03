import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const workflow = fs.readFileSync(
  new URL("../.github/workflows/orvyq-candidate-validation.yml", import.meta.url),
  "utf8",
);

// The plan's creative-coverage gate judges where contextual footage sits, and
// the footage distribution is authored from that same plan's claim/slice
// topology. Candidate Validation therefore runs the planner twice: once with
// the gate deferred, purely to publish the topology, and once for real after
// the contract has been reconciled. Getting these five steps out of order
// silently reintroduces the cycle, so pin the sequence.
test("Candidate Validation authors, reconciles and only then judges the footage distribution", () => {
  const topologyIndex = workflow.indexOf("Publish the claim/slice topology for distribution authoring");
  const authorIndex = workflow.indexOf("Author the claim-bound contextual-footage distribution");
  const reconcileIndex = workflow.indexOf("Reconcile claim-bound footage contracts after shot generation");
  const buildIndex = workflow.indexOf("Build the canonical full production shot list from real data");
  const editIndex = workflow.indexOf("Build the canonical candidate edit plan");

  assert.ok(topologyIndex >= 0, "topology pass is missing");
  assert.ok(authorIndex > topologyIndex, "the distribution must be authored against a published topology");
  assert.ok(reconcileIndex > authorIndex, "footage contracts must be reconciled after the distribution is authored");
  assert.ok(buildIndex > reconcileIndex, "the enforced plan pass must consume the reconciled contract");
  assert.ok(editIndex > buildIndex, "edit-plan validation must consume the reconciled canonical blueprint");
});

test("only the topology pass defers the creative-coverage gate", () => {
  const planRuns = [...workflow.matchAll(/node scripts\/orvyq_full_production_plan\.mjs[^\n]*/g)].map((match) => match[0]);
  assert.equal(planRuns.length, 2, `expected exactly two full-production passes, found ${planRuns.length}`);
  assert.equal(planRuns.filter((run) => run.includes("--defer-coverage-gate")).length, 1);
  assert.ok(planRuns[0].includes("--defer-coverage-gate"), "the first pass is the deferred topology pass");
  assert.ok(!planRuns[1].includes("--defer-coverage-gate"), "the second pass must enforce the gate");
});

test("the authoring and reconciliation steps run against the selected project", () => {
  assert.match(workflow, /node scripts\/orvyq_author_footage_distribution\.mjs --project-id="\$PROJECT_ID"/);
  assert.match(workflow, /node scripts\/orvyq_apply_footage_use_contracts\.mjs --project-id="\$PROJECT_ID"/);
});
