import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { resolveVisualRebalancePlan } from "./orvyq-visual-rebalance.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PROJECTS_ROOT = path.join(REPO_ROOT, "projects");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

test("every effective primary-evidence replacement uses the canonical manifest local_asset", () => {
  const checkedProjects = [];
  for (const projectId of fs.readdirSync(PROJECTS_ROOT).sort()) {
    const projectRoot = path.join(PROJECTS_ROOT, projectId);
    if (!fs.statSync(projectRoot).isDirectory()) continue;
    const planPath = path.join(projectRoot, "direction", "visual_rebalance_plan.json");
    const manifestPath = path.join(projectRoot, "research", "primary_evidence_manifest.json");
    if (!fs.existsSync(planPath) || !fs.existsSync(manifestPath)) continue;

    const plan = resolveVisualRebalancePlan(readJson(planPath));
    const manifest = readJson(manifestPath);
    const assets = new Map((manifest.assets || []).map((asset) => [asset.evidence_asset_id, asset]));

    for (const action of plan.actions || []) {
      if (action.decision !== "replace_primary_evidence") continue;
      assert.ok(
        Array.isArray(action.replacement_assets) && action.replacement_assets.length,
        `${projectId} shot ${action.baseline_shot_index} has no replacement_assets`,
      );
      for (const replacement of action.replacement_assets) {
        const canonical = assets.get(replacement.evidence_asset_id);
        assert.ok(
          canonical,
          `${projectId} shot ${action.baseline_shot_index} references unknown evidence asset ${replacement.evidence_asset_id}`,
        );
        assert.ok(
          typeof canonical.local_asset === "string" && canonical.local_asset.length,
          `${projectId} ${replacement.evidence_asset_id} has no canonical local_asset`,
        );
        assert.equal(
          replacement.asset_path,
          canonical.local_asset,
          `${projectId} shot ${action.baseline_shot_index} path drift for ${replacement.evidence_asset_id}`,
        );
      }
    }
    checkedProjects.push(projectId);
  }

  assert.ok(checkedProjects.length > 0, "no visual-rebalance projects with primary-evidence manifests were checked");
});
