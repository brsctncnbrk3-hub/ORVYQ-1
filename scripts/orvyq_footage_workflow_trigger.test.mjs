import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT } from "./lib/fs-utils.mjs";

const workflowPath = path.join(REPO_ROOT, ".github", "workflows", "orvyq-footage-acquisition.yml");

// A project's footage use-contract overrides have to be wired through the
// whole generic workflow -- it must fire on them, resolve the project from
// them, stage them when they exist, and upload them as diagnostics. Assert
// the four places rather than counting mentions, so consolidating the staging
// guard does not read as a regression.
test("footage use-contract overrides trigger, resolve, persist and upload through the generic workflow", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const section = (from, to) => workflow.slice(workflow.indexOf(from), to ? workflow.indexOf(to) : undefined);

  const triggers = section("on:", "permissions:");
  assert.match(triggers, /projects\/\*\/research\/footage_use_contract_overrides\.json/, "must fire on the overrides file");

  const resolve = section("Resolve selected project", "Set up Node");
  assert.match(resolve, /footage_use_contracts\|footage_use_contract_overrides\|footage_visual_decisions/, "must resolve the project from a changed overrides file");

  const commit = section("Commit footage state and review queue", "Upload acquisition and review diagnostics");
  assert.match(commit, /footage_use_contract_overrides\.json/, "must stage the overrides file");

  const diagnostics = section("Upload acquisition and review diagnostics", "Report footage preparation");
  assert.match(diagnostics, /footage_use_contract_overrides\.json/, "must upload the overrides file as a diagnostic");
});

// The overrides file is optional, so staging it must survive its absence.
// Both this and the plain `test ! -f ... ||` idiom it replaced satisfy that;
// what must never happen is a bare `git add` of it.
test("an absent overrides file cannot fail the commit step", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const commit = workflow.slice(
    workflow.indexOf("Commit footage state and review queue"),
    workflow.indexOf("Upload acquisition and review diagnostics"),
  );

  const guarded = /\[ -e "\$candidate" \]/.test(commit) || /test ! -f .*footage_use_contract_overrides\.json/.test(commit);
  assert.ok(guarded, "the optional overrides file must be staged behind an existence check");

  const bareAdd = new RegExp(String.raw`git add(?![^\n]*\$\{present\[@\]\})[^\n]*footage_use_contract_overrides\.json`);
  assert.ok(!bareAdd.test(commit), "the overrides file must never be handed to git add unguarded");
});
