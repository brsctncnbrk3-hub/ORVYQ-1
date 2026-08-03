import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { auditSystemIndependence, listProjectIds } from "./orvyq_system_independence_audit.mjs";

async function makeRepo(files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "orvyq-independence-"));
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(root, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents);
  }
  return root;
}

const CLEAN_WORKFLOW = `name: ORVYQ Candidate Validation
on:
  workflow_dispatch:
    inputs:
      project_id:
        required: true
jobs:
  validate:
    steps:
      - run: node scripts/orvyq_full_production_plan.mjs --project-id="$PROJECT_ID"
`;

test("a system that names no project passes", async () => {
  const root = await makeRepo({
    "projects/007-a-film/project.json": "{}",
    ".github/workflows/ci.yml": CLEAN_WORKFLOW,
    "scripts/run.mjs": "export const run = (projectId) => projectId;\n",
  });
  const report = await auditSystemIndependence({ repoRoot: root });
  assert.equal(report.pass, true, JSON.stringify(report.violations));
  assert.deepEqual(report.project_ids, ["007-a-film"]);
});

test("a project id that did not exist when the guard was written is still caught", async () => {
  const root = await makeRepo({
    "projects/007-a-film/project.json": "{}",
    "projects/008-another-film/project.json": "{}",
    ".github/workflows/patch.yml": "jobs:\n  patch:\n    env:\n      PROJECT_ID: 008-another-film\n",
  });
  const report = await auditSystemIndependence({ repoRoot: root });
  assert.equal(report.pass, false);
  assert.deepEqual(
    report.violations.map((violation) => [violation.file, violation.rule, violation.detail]),
    [[".github/workflows/patch.yml", "project_id", "008-another-film"]],
  );
});

test("a workflow pinned to one working branch is caught", async () => {
  const root = await makeRepo({
    "projects/007-a-film/project.json": "{}",
    ".github/workflows/patch.yml": "on:\n  push:\n    branches:\n      - \"agent/some-working-branch\"\n",
  });
  const report = await auditSystemIndependence({ repoRoot: root });
  assert.equal(report.pass, false);
  assert.equal(report.violations[0].rule, "working_branch_pin");
  assert.equal(report.violations[0].detail, "agent/some-working-branch");
});

test("a branch glob is how a reusable workflow targets working branches, not a pin", async () => {
  const root = await makeRepo({
    "projects/007-a-film/project.json": "{}",
    ".github/workflows/request.yml": "on:\n  push:\n    branches:\n      - \"agent/**\"\n      - \"claude/**\"\n    paths:\n      - \"projects/*/config/request.json\"\n",
  });
  assert.equal((await auditSystemIndependence({ repoRoot: root })).pass, true);
});

test("a concrete acquired clip name in system code is caught", async () => {
  const root = await makeRepo({
    "projects/007-a-film/project.json": "{}",
    "scripts/plan.mjs": "const fallback = 'assets/footage/scene_012_38081600.mp4';\n",
  });
  const report = await auditSystemIndependence({ repoRoot: root });
  assert.equal(report.pass, false);
  assert.equal(report.violations[0].rule, "concrete_provider_asset");
});

test("tests may name the live acceptance project and fixture assets", async () => {
  const root = await makeRepo({
    "projects/007-a-film/project.json": "{}",
    "scripts/plan.test.mjs": "const id = '007-a-film';\nconst asset = 'scene_012_38081600.mp4';\n",
  });
  assert.equal((await auditSystemIndependence({ repoRoot: root })).pass, true);
});

test("a media rule pinned to one project is caught in .gitattributes", async () => {
  const root = await makeRepo({
    "projects/007-a-film/project.json": "{}",
    "projects/008-another-film/project.json": "{}",
    ".gitattributes": "*.mp4 filter=lfs diff=lfs merge=lfs -text\nprojects/007-a-film/assets/footage/*.mp4 -filter -diff -merge -text\n",
  });
  const report = await auditSystemIndependence({ repoRoot: root });
  assert.equal(report.pass, false);
  assert.equal(report.violations[0].file, ".gitattributes");
  assert.equal(report.violations[0].detail, "007-a-film");
});

test("a media rule written for every project is not a leak", async () => {
  const root = await makeRepo({
    "projects/007-a-film/project.json": "{}",
    ".gitattributes": "*.mp4 filter=lfs diff=lfs merge=lfs -text\nprojects/*/assets/footage/*.mp4 -filter -diff -merge -text\n",
  });
  assert.equal((await auditSystemIndependence({ repoRoot: root })).pass, true);
});

test("project directories are the sole source of the id list", async () => {
  const root = await makeRepo({
    "projects/009-c-film/project.json": "{}",
    "projects/007-a-film/project.json": "{}",
    "projects/_index.json": "{}",
  });
  assert.deepEqual(await listProjectIds(root), ["007-a-film", "009-c-film"]);
});
