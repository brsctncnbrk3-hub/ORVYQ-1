#!/usr/bin/env node
import crypto from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { projectDir, readJson, writeJsonAtomic, parseArgs, printJson } from "./lib/fs-utils.mjs";

const execFileAsync = promisify(execFile);
const FRAME_COUNT = 12;
const COLUMNS = 4;
const ROWS = 3;

const exists = async (file) => fs.access(file).then(() => true, () => false);
const sha256 = async (file) => crypto.createHash("sha256").update(await fs.readFile(file)).digest("hex");

async function probeDuration(file) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  const duration = Number(stdout.trim());
  if (!(duration > 0)) throw new Error(`Could not determine duration for ${file}`);
  return duration;
}

async function generateContactSheet(media, output, duration) {
  const interval = Math.max(0.1, duration / FRAME_COUNT);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await execFileAsync("ffmpeg", [
    "-y",
    "-i", media,
    "-vf", `fps=1/${interval},scale=480:-2,tile=${COLUMNS}x${ROWS}:padding=8:margin=8`,
    "-frames:v", "1",
    "-q:v", "2",
    output,
  ], { maxBuffer: 20 * 1024 * 1024 });
}

export function exactByteApproval(reviews, providerAssetId, assetHash) {
  return (reviews.approved_assets || []).find((item) =>
    String(item.provider_asset_id) === String(providerAssetId) &&
    String(item.asset_sha256).toLowerCase() === String(assetHash).toLowerCase() &&
    /^[a-f0-9]{64}$/i.test(String(item.contact_sheet_sha256 || "")),
  ) || null;
}

export function canReuseApprovedContactSheet(reviews, providerAssetId, assetHash, contactSheetExists) {
  return Boolean(contactSheetExists && exactByteApproval(reviews, providerAssetId, assetHash));
}

export async function generateFootageContactSheets(projectId) {
  const dir = projectDir(projectId);
  const runtime = await readJson(path.join(dir, "assets", "footage_acquisition.runtime.json"));
  const reviews = await readJson(path.join(dir, "research", "visual_asset_reviews.json"));
  const plan = await readJson(path.join(dir, "research", "footage_acquisition_plan.json"));
  const planByScene = new Map((plan.assets || []).map((item) => [item.scene_id, item]));
  const outputDir = path.join(dir, "qa", "footage-contact-sheets");
  const entries = [];

  for (const record of runtime.records || []) {
    const media = path.join(dir, record.path || "");
    const provenanceFile = `${media}.provenance.json`;
    if (!(await exists(media)) || !(await exists(provenanceFile))) {
      throw new Error(`${record.scene_id}: runtime media or provenance is missing`);
    }
    const provenance = await readJson(provenanceFile);
    const assetHash = await sha256(media);
    if (assetHash !== provenance.sha256 && assetHash !== provenance.actual_sha256) {
      throw new Error(`${record.scene_id}: asset bytes do not match provenance`);
    }
    const contactSheetRelative = `qa/footage-contact-sheets/${record.scene_id}.jpg`;
    const contactSheet = path.join(dir, contactSheetRelative);
    const approval = exactByteApproval(reviews, provenance.provider_asset_id, assetHash);
    if (canReuseApprovedContactSheet(
      reviews,
      provenance.provider_asset_id,
      assetHash,
      await exists(contactSheet),
    )) continue;

    const duration = await probeDuration(media);
    await generateContactSheet(media, contactSheet, duration);
    const contactSheetHash = await sha256(contactSheet);
    if (String(approval?.contact_sheet_sha256 || "").toLowerCase() === contactSheetHash.toLowerCase()) continue;
    const item = planByScene.get(record.scene_id) || {};

    entries.push({
      scene_id: record.scene_id,
      asset_path: record.path,
      provider: provenance.provider,
      provider_asset_id: String(provenance.provider_asset_id),
      source_page_url: provenance.source_page_url,
      creator: provenance.creator || null,
      asset_sha256: assetHash,
      contact_sheet_path: contactSheetRelative,
      contact_sheet_sha256: contactSheetHash,
      reviewed_frame_count: FRAME_COUNT,
      duration_seconds: duration,
      editorial_role: item.role || provenance.editorial_role || "context",
      narration_anchor: item.editorial_assignment?.narration_anchor || provenance.narration_anchor || null,
      claim_id: item.editorial_assignment?.claim_id || provenance.target_claim_id || null,
      semantic_rationale: item.editorial_assignment?.semantic_rationale || item.editorial_note || provenance.editorial_note || null,
      status: "pending_visual_review",
    });
  }

  const manifest = {
    schema_version: "1.0",
    project_id: projectId,
    generated_at: new Date().toISOString(),
    frame_count_per_sheet: FRAME_COUNT,
    pending_review_count: entries.length,
    entries,
  };
  await writeJsonAtomic(path.join(dir, "qa", "footage_contact_sheets.json"), manifest);
  return manifest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const projectId = args["project-id"] || args.project;
  if (!projectId) throw new Error("--project-id is required");
  printJson(await generateFootageContactSheets(projectId));
}
