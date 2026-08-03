import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowsDir = path.join(root, ".github", "workflows");
const actionReference = "uses: ./.github/actions/dispatch-required-checks";

test("every workflow that pushes an automation commit dispatches required checks", () => {
  const pushWorkflows = fs.readdirSync(workflowsDir)
    .filter((name) => name.endsWith(".yml"))
    .map((name) => ({ name, text: fs.readFileSync(path.join(workflowsDir, name), "utf8") }))
    .filter(({ text }) => /git push origin/.test(text));

  assert.ok(pushWorkflows.length > 0, "expected at least one automation-push workflow");
  for (const { name, text } of pushWorkflows) {
    assert.match(text, /actions: write/, `${name} cannot dispatch the required workflows`);
    assert.ok(text.includes(actionReference), `${name} does not validate its automation-authored head`);
  }
});

test("the shared dispatcher runs both ruleset contexts on the selected branch", () => {
  const action = fs.readFileSync(path.join(root, ".github", "actions", "dispatch-required-checks", "action.yml"), "utf8");
  assert.match(action, /gh workflow run ci\.yml/);
  assert.match(action, /gh workflow run repository-discipline\.yml/);
  assert.match(action, /--ref "\$TARGET_BRANCH"/);
  assert.match(action, /head_branch="\$TARGET_BRANCH"/);
});

test("a dispatch can produce the required single-active-PR job without running cleanup", () => {
  const discipline = fs.readFileSync(path.join(workflowsDir, "repository-discipline.yml"), "utf8");
  assert.match(discipline, /github\.event_name == 'workflow_dispatch' && inputs\.head_branch != ''/);
  assert.match(discipline, /inputs\.cleanup_merged_branches == true/);
});
