import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT } from "./lib/fs-utils.mjs";

const legacyRepositoryTokens = ["brsctncnbrk-ops", "YouTube_pepline"];
const projectLeakageTokens = [
  "001-the-ai-race-no-one-can-afford-to-win",
  "scene_024_6e6f4af26cad60cc78930d6d.mp4",
  "30200283806",
];
const repositoryRoots = [".github", "scripts", "projects", "templates", "package.json"];
const systemRoots = [".github", "scripts", "templates", "config", "package.json"];
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

test("system runtime contains no project id, project asset, or review-run dependency", async () => {
  assert.deepEqual(await findViolations(systemRoots, projectLeakageTokens), []);
});
