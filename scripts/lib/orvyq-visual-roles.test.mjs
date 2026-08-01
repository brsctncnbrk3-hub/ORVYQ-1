import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readdir } from "node:fs/promises";
import { REPO_ROOT, PROJECTS_DIR, readJson, pathExists } from "./fs-utils.mjs";
import {
  CANONICAL_VISUAL_ROLES,
  canonicalVisualRole,
  isCanonicalVisualRole,
} from "./orvyq-visual-roles.mjs";

test("editorial governance/science aliases normalize to the canonical context role", () => {
  assert.equal(canonicalVisualRole("governance_context"), "context");
  assert.equal(canonicalVisualRole("scientific_context"), "context");
});

test("unknown visual roles fail closed instead of becoming project-specific renderer vocabulary", () => {
  assert.throws(() => canonicalVisualRole("deep_sea_policy_context"), /Unsupported visual role/);
});

test("shot schema visual_role enum matches the shared canonical role vocabulary", async () => {
  const schema = await readJson(path.join(REPO_ROOT, "schemas", "shot.schema.json"));
  assert.deepEqual(
    [...schema.properties.visual_role.enum].sort(),
    [...CANONICAL_VISUAL_ROLES].sort(),
  );
});

test("every committed motion hook uses canonical roles before full-production planning", async () => {
  for (const entry of await readdir(PROJECTS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const hookPath = path.join(PROJECTS_DIR, entry.name, "direction", "motion_hook.json");
    if (!(await pathExists(hookPath))) continue;
    const hook = await readJson(hookPath);
    for (const [index, shot] of (hook.shots || []).entries()) {
      assert.equal(
        isCanonicalVisualRole(shot.visual_role),
        true,
        `${entry.name} motion_hook.shots[${index}] uses non-canonical role ${shot.visual_role}`,
      );
    }
  }
});
