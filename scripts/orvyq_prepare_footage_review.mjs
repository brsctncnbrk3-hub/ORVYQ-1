#!/usr/bin/env node
import crypto from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  projectDir,
  readJson,
  writeJsonAtomic,
  parseArgs,
  printJson,
} from "./lib/fs-utils.mjs";

const execFileAsync = promisify(execFile);
const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

async function probeDuration(filePath) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=nw=1:nk=1",
    filePath,
  ], { maxBuffer: 2 * 1024 * 1024 });
  const duration = Number(String(stdout).trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`${filePath}: invalid duration ${stdout}`);
  }
  return duration;
}

function samplePositions(duration) {
  return [
    Math.min(0.5, Math.max(0, duration - 0.05)),
    Math.max(0, Math.min(duration * 0.33, duration - 0.05)),
    Math.max(0, Math.min(duration * 0.66, duration - 0.05)),
    Math.max(0, duration - 0.5),
  ];
}

async function extractFrame(clip, timestamp, output) {
  await execFileAsync("ffmpeg", [
    "-nostdin", "-v", "error", "-y",
    "-ss", timestamp.toFixed(3),
    "-i", clip,
    "-frames:v", "1",
    "-vf", "scale=480:270:force_original_aspect_ratio=decrease,pad=480:270:(ow-iw)/2:(oh-ih)/2:black,setsar=1",
    output,
  ], { maxBuffer: 8 * 1024 * 1024 });
}

async function combineFrames(frames, output) {
  await execFileAsync("ffmpeg", [
    "-nostdin", "-v", "error", "-y",
    "-i", frames[0], "-i", frames[1], "-i", frames[2], "-i", frames[3],
    "-filter_complex", "[0:v][1:v]hstack=inputs=2[top];[2:v][3:v]hstack=inputs=2[bottom];[top][bottom]vstack=inputs=2[sheet]",
    "-map", "[sheet]",
    "-frames:v", "1",
    output,
  ], { maxBuffer: 8 * 1024 * 1024 });
}

function uniqueUses(uses) {
  const seen = new Set();
  const output = [];
  for (const use of uses) {
    const key = `${use.claim_id}\u0000${use.narration_anchor}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(use);
  }
  return output;
}

export async function prepareFootageReview(projectId) {
  const root = projectDir(projectId);
  const [runtime, manifest, motionHook] = await Promise.all([
    readJson(path.join(root, "assets", "footage_acquisition.runtime.json")),
    readJson(path.join(root, "research", "selected_pexels_manifest.json")),
    readJson(path.join(root, "direction", "motion_hook.json")),
  ]);
  if (runtime.project_id !== projectId || manifest.project_id !== projectId || motionHook.project_id !== projectId) {
    throw new Error("Project id mismatch while preparing footage review");
  }
  const expectedCount = Array.isArray(manifest.assets) ? manifest.assets.length : 0;
  if (!expectedCount) throw new Error("Selected footage manifest has no reviewable assets");
  if (
    runtime.pass !== true ||
    Number(runtime.planned_asset_count) !== expectedCount ||
    (runtime.records || []).length !== expectedCount ||
    (runtime.unresolved_scene_ids || []).length !== 0
  ) {
    throw new Error(
      `Footage acquisition must pass with every selected record (expected=${expectedCount}, planned=${runtime.planned_asset_count}, records=${(runtime.records || []).length})`,
    );
  }

  const byScene = new Map((manifest.assets || []).map((item) => [item.scene_id, item]));
  const hookUsesByScene = new Map();
  for (const hookShot of motionHook.shots || []) {
    const list = hookUsesByScene.get(hookShot.scene_id) || [];
    list.push({
      claim_id: hookShot.claim_id,
      narration_anchor: hookShot.narration_anchor,
      semantic_rationale: hookShot.semantic_rationale ||
        `Use ${hookShot.scene_id} as a brief opening image that gives the stated race-and-governance narration a concrete physical context without treating generic stock as proof.`,
      semantic_link: hookShot.semantic_link || "physical",
    });
    hookUsesByScene.set(hookShot.scene_id, list);
  }

  const outDir = path.join(root, "qa", "footage-contact-sheets");
  const tempDir = path.join(root, "qa", ".footage-contact-sheet-tmp");
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.rm(tempDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });
  await fs.mkdir(tempDir, { recursive: true });

  const entries = [];
  try {
    for (const record of runtime.records) {
      const planned = byScene.get(record.scene_id);
      if (!planned) throw new Error(`${record.scene_id}: selected manifest entry is missing`);
      const clip = path.join(root, record.path);
      const assetBuffer = await fs.readFile(clip);
      const actualAssetSha = sha256(assetBuffer);
      const provenance = await readJson(path.join(root, `${record.path}.provenance.json`));
      const provenanceSha = String(provenance.actual_sha256 || provenance.sha256 || "").toLowerCase();
      if (actualAssetSha !== provenanceSha) {
        throw new Error(`${record.scene_id}: footage bytes do not match provenance`);
      }

      const duration = await probeDuration(clip);
      const clipTemp = path.join(tempDir, path.basename(record.path, ".mp4"));
      await fs.mkdir(clipTemp, { recursive: true });
      const framePaths = [];
      for (const [index, timestamp] of samplePositions(duration).entries()) {
        const framePath = path.join(clipTemp, `frame_${index + 1}.jpg`);
        await extractFrame(clip, timestamp, framePath);
        framePaths.push(framePath);
      }
      const contactSheetPath = `qa/footage-contact-sheets/${path.basename(record.path, ".mp4")}.jpg`;
      const absoluteSheet = path.join(root, contactSheetPath);
      await combineFrames(framePaths, absoluteSheet);
      const sheetBuffer = await fs.readFile(absoluteSheet);

      const approvedUses = uniqueUses([{
        claim_id: record.claim_id,
        narration_anchor: planned.narration_anchor,
        semantic_rationale: planned.semantic_rationale,
        semantic_link: planned.semantic_link || "physical",
      }, ...(hookUsesByScene.get(record.scene_id) || [])]);

      entries.push({
        scene_id: record.scene_id,
        provider_asset_id: String(record.provider_asset_id),
        status: "pending_visual_review",
        asset_path: record.path,
        asset_sha256: actualAssetSha,
        contact_sheet_path: contactSheetPath,
        contact_sheet_sha256: sha256(sheetBuffer),
        duration_seconds: provenance.actual_duration_seconds || provenance.duration || duration,
        transformation: provenance.transformation || null,
        sampled_positions: ["opening", "one_third", "two_thirds", "near_end"],
        approved_uses_if_visually_valid: approvedUses,
        review_blockers: [],
      });
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }

  entries.sort((a, b) => a.scene_id.localeCompare(b.scene_id));
  if (entries.length !== expectedCount) throw new Error(`Expected ${expectedCount} review entries, found ${entries.length}`);
  const queue = {
    schema_version: "1.2-four-position",
    project_id: projectId,
    generated_at: new Date().toISOString(),
    review_method: "four-position claim-specific contact-sheet review",
    pending_review_count: entries.length,
    entries_with_exact_uses: entries.filter((entry) => entry.approved_uses_if_visually_valid.length > 0).length,
    entries,
  };
  await writeJsonAtomic(path.join(root, "qa", "footage_review_queue.json"), queue);
  return {
    project_id: projectId,
    contact_sheet_count: entries.length,
    queue_entry_count: entries.length,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const projectId = args["project-id"] || args.project;
  if (!projectId) throw new Error("--project-id is required");
  prepareFootageReview(projectId)
    .then((result) => printJson({ ok: true, ...result }))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
