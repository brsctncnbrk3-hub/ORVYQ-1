import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const workflow = fs.readFileSync(
  new URL("../.github/workflows/orvyq-footage-acquisition.yml", import.meta.url),
  "utf8",
);

// Footage acquisition has to be able to run against a project that has not
// produced its optional artefacts yet: a fresh project, or one whose pool was
// retired for a rebuild. Under `set -euo pipefail` a `git add` on a path that
// does not exist fails the whole step, and an unmatched glob reaches git as a
// literal pattern and does the same. Both stopped a rebuild from committing
// the footage it had just downloaded.
const OPTIONAL_PATHS = [
  "footage_constraint_overrides.json",
  "footage_use_contract_overrides.json",
  "footage_visual_decisions",
  "local_assets.provenance.json",
  "footage_semantic_review_audit.json",
];

test("the commit step stages only paths that exist", () => {
  const step = workflow.slice(
    workflow.indexOf("Commit footage state and review queue"),
    workflow.indexOf("Upload acquisition and review diagnostics"),
  );
  assert.ok(step.length > 0, "commit step is missing");

  assert.match(step, /shopt -s nullglob/, "an unmatched glob must not reach git as a literal");
  assert.match(step, /add_existing\(\)/, "optional paths must go through an existence filter");
  assert.match(step, /\[ -e "\$candidate" \]/, "the filter must test for existence");

  // No optional path may be handed to git add directly.
  const directAdds = [...step.matchAll(/^\s*git add(?! -- "\$\{present\[@\]\}"| -f -- "\$\{present\[@\]\}").*$/gm)]
    .map((match) => match[0]);
  for (const line of directAdds) {
    for (const optional of OPTIONAL_PATHS) {
      assert.ok(
        !line.includes(optional),
        `${optional} is staged without an existence check: ${line.trim()}`,
      );
    }
  }
});

test("the acquisition workflow still verifies the provider credential before downloading", () => {
  const credentialIndex = workflow.indexOf("Verify Pexels credential exists");
  const acquireIndex = workflow.indexOf("Reacquire rejected licensed contextual footage");
  assert.ok(credentialIndex >= 0, "credential check is missing");
  assert.ok(acquireIndex > credentialIndex, "the credential must be checked before any download");
});

test("the workflow targets any project rather than a pinned one", () => {
  assert.match(workflow, /projects\/\*\//, "path triggers must be project-independent");
  assert.ok(
    !/projects\/[0-9]{3}-[a-z0-9-]+\//.test(workflow),
    "no concrete project directory may be pinned in the acquisition workflow",
  );
});

test("the workflow detects rejected selections before deciding to apply them", () => {
  assert.match(workflow, /orvyq_footage_candidate_stage\.mjs/);
  assert.match(workflow, /--replacement-only/);
  assert.doesNotMatch(workflow, /if \[ -f .*footage_candidate_selection\.json/);
});
