#!/usr/bin/env node
// Fails when a specific film leaks into the reusable system.
//
// The previous guard grepped for three hand-written tokens taken from one
// past project, so it could only ever catch that project. Every later film's
// id, branch and asset names walked straight past it -- which is how a whole
// family of workflows ended up pinned to one branch and one project id while
// CI stayed green.
//
// This audit derives what to look for instead of listing it: every project id
// that actually exists under `projects/`, plus the structural shapes of
// project-specific data (concrete provider asset filenames, concrete working
// branch pins). A new project is covered the moment it is created.
import path from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import { REPO_ROOT, parseArgs, printJson } from "./lib/fs-utils.mjs";

// The reusable system: everything a fresh project would inherit unchanged.
export const SYSTEM_ROOTS = Object.freeze([".github", "scripts", "templates", "config", "package.json"]);

const IGNORED_DIRECTORIES = new Set(["node_modules", ".git", "out", ".remotion", "qa", "migration"]);

// Tests legitimately name the repository's live acceptance project (see
// ORVYQ_SYSTEM.md section 14) and carry fixture asset names; they are not
// what a new project inherits at runtime.
const isTestFile = (relativePath) => /\.test\.mjs$/.test(relativePath);

export const STRUCTURAL_RULES = Object.freeze([
  {
    id: "concrete_provider_asset",
    // `scene_012_38081600.mp4` -- one film's downloaded clip, not a shape the
    // system should ever hard-code.
    pattern: /scene_\d{3}_[0-9a-f]{6,}\.(?:mp4|mov|jpg|jpeg|png|webp)/gi,
    message: "names a concrete acquired project asset",
  },
  {
    id: "working_branch_pin",
    // `agent/project-001-clean-rebuild` -- a workflow pinned to one session's
    // branch runs for nobody else and fails for everybody else.
    pattern: /(?:^|["'\s/])(?:agent|claude|setup)\/[a-z0-9]+(?:-[a-z0-9]+)+/g,
    message: "pins a concrete working branch",
    roots: [".github", "config", "package.json"],
  },
]);

async function filesUnder(absolutePath) {
  const stats = await stat(absolutePath).catch(() => null);
  if (!stats) return [];
  if (stats.isFile()) return [absolutePath];
  const files = [];
  for (const entry of await readdir(absolutePath, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
    const child = path.join(absolutePath, entry.name);
    files.push(...(entry.isDirectory() ? await filesUnder(child) : [child]));
  }
  return files;
}

export async function listProjectIds(repoRoot = REPO_ROOT) {
  const entries = await readdir(path.join(repoRoot, "projects"), { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name)
    .sort();
}

export async function auditSystemIndependence({
  repoRoot = REPO_ROOT,
  roots = SYSTEM_ROOTS,
  projectIds = null,
  ignoreFiles = [],
} = {}) {
  const ids = projectIds || (await listProjectIds(repoRoot));
  const ignored = new Set([...ignoreFiles, "scripts/orvyq_system_independence_audit.mjs", "scripts/orvyq_system_independence_audit.test.mjs"]);
  const violations = [];

  for (const root of roots) {
    for (const file of await filesUnder(path.join(repoRoot, root))) {
      const relative = path.relative(repoRoot, file).split(path.sep).join("/");
      if (ignored.has(relative)) continue;
      const contents = await readFile(file, "utf8").catch(() => null);
      if (contents === null) continue;

      if (!isTestFile(relative)) {
        for (const projectId of ids) {
          if (contents.includes(projectId)) {
            violations.push({ file: relative, rule: "project_id", detail: projectId, message: `hard-codes project ${projectId}` });
          }
        }
      }

      for (const rule of STRUCTURAL_RULES) {
        if (rule.roots && !rule.roots.includes(root)) continue;
        if (isTestFile(relative)) continue;
        const matches = [...new Set((contents.match(rule.pattern) || []).map((match) => match.trim().replace(/^["'/]/, "")))];
        for (const match of matches) {
          violations.push({ file: relative, rule: rule.id, detail: match, message: `${rule.message} (${match})` });
        }
      }
    }
  }

  violations.sort((a, b) => a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule) || a.detail.localeCompare(b.detail));
  return { project_ids: ids, scanned_roots: [...roots], violations, pass: violations.length === 0 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  auditSystemIndependence({ repoRoot: args["repo-root"] || REPO_ROOT })
    .then((report) => {
      printJson({ ok: report.pass, ...report });
      if (!report.pass) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
