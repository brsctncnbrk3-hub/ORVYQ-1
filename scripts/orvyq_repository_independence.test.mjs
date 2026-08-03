import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT } from "./lib/fs-utils.mjs";
import { auditSystemIndependence, listProjectIds } from "./orvyq_system_independence_audit.mjs";

const legacyRepositoryTokens = ["brsctncnbrk-ops", "YouTube_pepline"];
const repositoryRoots = [".github", "scripts", "projects", "templates", "package.json"];
const ignoredDirectories = new Set(["node_modules", ".git", "qa", "migration"]);

async function filesUnder(absolutePath) {
  if ((await stat(absolutePath)).isFile()) return [absolutePath];
  const files = [];
  for (const entry of await readdir(absolutePath, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const child = path.join(absolutePath, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(child));
    else files.push(child);
  }
  return files;
}

async function findViolations(roots, tokens) {
  const violations = [];
  for (const root of roots) {
    for (const file of await filesUnder(path.join(REPO_ROOT, root))) {
      if (file.endsWith("orvyq_repository_independence.test.mjs")) continue;
      const contents = await readFile(file, "utf8").catch(() => "");
      for (const token of tokens) {
        if (contents.includes(token)) {
          violations.push(`${path.relative(REPO_ROOT, file)} contains ${token}`);
        }
      }
    }
  }
  return violations;
}

test("runtime and production configuration contain no legacy repository dependency", async () => {
  assert.deepEqual(await findViolations(repositoryRoots, legacyRepositoryTokens), []);
});

// Derived from what is actually in `projects/` rather than from a token list,
// so a project created after this test was written is still covered.
test("system runtime hard-codes no project id, project asset or working branch", async () => {
  const report = await auditSystemIndependence();
  assert.deepEqual(
    report.violations.map((violation) => `${violation.file}: ${violation.message}`),
    [],
  );
});

test("the independence audit actually sees every project that exists", async () => {
  const ids = await listProjectIds();
  assert.ok(ids.length > 0, "expected at least one project to audit against");
  assert.deepEqual((await auditSystemIndependence()).project_ids, ids);
});
