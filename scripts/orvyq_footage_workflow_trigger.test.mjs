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
