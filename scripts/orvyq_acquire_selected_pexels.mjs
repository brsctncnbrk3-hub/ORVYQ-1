#!/usr/bin/env node
import crypto from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
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
const PEXELS_LICENSE = "https://www.pexels.com/license/";
const USER_AGENT = "ORVYQ-selected-pexels-acquisition/1.0";
const ALLOWED_FINAL_HOSTS = new Set(["videos.pexels.com"]);

const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const safeSceneId = (value) => {
  const id = String(value || "").trim();
  if (!/^scene_\d{3}$/.test(id)) throw new Error(`Invalid scene_id: ${id}`);
  return id;
};

async function probe(file) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "format=duration,format_name:stream=codec_name,width,height",
    "-of", "json",
    file,
  ], { maxBuffer: 4 * 1024 * 1024 });
  const parsed = JSON.parse(stdout);
  const stream = parsed.streams?.[0] || {};
  return {
    duration: Number(parsed.format?.duration || 0),
    container: parsed.format?.format_name || null,
    codec: stream.codec_name || null,
    width: Number(stream.width || 0),
    height: Number(stream.height || 0),
  };
}

function isAllowedMediaUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && ALLOWED_FINAL_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

function extractPexelsVideoUrls(html) {
  const decoded = String(html || "")
    .replaceAll("\\u0026", "&")
    .replaceAll("\\/", "/")
    .replaceAll("&amp;", "&");
  const matches = decoded.match(/https:\/\/videos\.pexels\.com\/video-files\/[^\"'<>\s]+/g) || [];
  return [...new Set(matches.map((url) => url.replace(/[),]+$/, "")))].filter(isAllowedMediaUrl);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 120000) {
  return fetch(url, {
    ...options,
    headers: {
      "user-agent": USER_AGENT,
      accept: options.accept || "*/*",
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function resolveMediaUrl(providerAssetId) {
  const downloadUrl = `https://www.pexels.com/download/video/${providerAssetId}/`;
  const direct = await fetchWithTimeout(downloadUrl, { redirect: "follow" }, 120000);
  const directType = String(direct.headers.get("content-type") || "").toLowerCase();
  if (direct.ok && directType.includes("video") && isAllowedMediaUrl(direct.url)) {
    return { response: direct, finalUrl: direct.url, resolutionMode: "pexels_download_redirect" };
  }

  const sourcePageUrl = `https://www.pexels.com/video/${providerAssetId}/`;
  const page = await fetchWithTimeout(sourcePageUrl, { redirect: "follow", accept: "text/html" }, 60000);
  if (!page.ok) throw new Error(`Pexels source page failed ${page.status}`);
  const html = await page.text();
  const candidates = extractPexelsVideoUrls(html);
  if (!candidates.length) {
    throw new Error(`No Pexels CDN video URL found for provider asset ${providerAssetId}`);
  }
  for (const candidate of candidates) {
    const response = await fetchWithTimeout(candidate, { redirect: "follow" }, 180000);
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (response.ok && contentType.includes("video") && isAllowedMediaUrl(response.url)) {
      return { response, finalUrl: response.url, resolutionMode: "source_page_cdn_resolution" };
    }
  }
  throw new Error(`No downloadable Pexels CDN rendition succeeded for ${providerAssetId}`);
}

async function writeResponseToFile(response, target) {
  if (!response.body) throw new Error("Pexels media response has no body");
  await pipeline(Readable.fromWeb(response.body), (await import("node:fs")).createWriteStream(target));
  const stat = await fs.stat(target);
  if (stat.size < 250000) throw new Error(`Downloaded video is unexpectedly small: ${stat.size} bytes`);
  return stat.size;
}

async function compact(source, output, durationSeconds, sourceDurationSeconds) {
  const args = ["-y"];
  if (Number(sourceDurationSeconds || 0) + 0.05 < Number(durationSeconds || 0)) {
    args.push("-stream_loop", "-1");
  }
  args.push(
    "-i", source,
    "-t", String(durationSeconds),
    "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:black,setsar=1",
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "25",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-an",
    output,
  );
  await execFileAsync("ffmpeg", args, { maxBuffer: 24 * 1024 * 1024 });
}

async function acquireCandidate(projectId, dir, item, providerAssetId) {
  const id = safeSceneId(item.scene_id);
  const tempDir = path.join(dir, "assets", ".acquisition-tmp");
  const footageDir = path.join(dir, "assets", "footage");
  await fs.mkdir(tempDir, { recursive: true });
  await fs.mkdir(footageDir, { recursive: true });
  const source = path.join(tempDir, `${id}_${providerAssetId}.source.mp4`);
  const relative = `assets/footage/${id}_${providerAssetId}.mp4`;
  const output = path.join(dir, relative);
  const { response, finalUrl, resolutionMode } = await resolveMediaUrl(providerAssetId);
  let sourceBytes = 0;
  try {
    sourceBytes = await writeResponseToFile(response, source);
    const sourceInfo = await probe(source);
    if (!(sourceInfo.width > 0 && sourceInfo.height > 0 && sourceInfo.duration > 0)) {
      throw new Error(`invalid source media ${sourceInfo.width}x${sourceInfo.height} duration=${sourceInfo.duration}`);
    }
    const minimumDuration = Number(item.min_duration_seconds || 8);
    const requested = Math.min(
      Math.max(Number(item.output_duration_seconds || 10), minimumDuration),
      12,
    );
    await compact(source, output, requested, sourceInfo.duration);
  } finally {
    await fs.rm(source, { force: true });
  }

  const info = await probe(output);
  if (info.width !== 1280 || info.height !== 720) {
    await fs.rm(output, { force: true });
    throw new Error(`compacted clip failed exact HD validation ${info.width}x${info.height}`);
  }
  const buffer = await fs.readFile(output);
  const digest = sha256(buffer);
  const sourcePageUrl = `https://www.pexels.com/video/${providerAssetId}/`;
  const provenance = {
    schema_version: "1.0",
    project_id: projectId,
    scene_id: id,
    claim_id: item.claim_id,
    provider: "pexels",
    provider_asset_id: String(providerAssetId),
    source_page_url: sourcePageUrl,
    resolved_media_url: finalUrl,
    resolution_mode: resolutionMode,
    license_name: "Pexels License",
    license_url: PEXELS_LICENSE,
    creator: item.creator || null,
    source_title: item.source_title || null,
    retrieval_timestamp: new Date().toISOString(),
    editorial_role: item.role || "context",
    narration_anchor: item.narration_anchor,
    semantic_rationale: item.semantic_rationale,
    semantic_link: item.semantic_link || "physical",
    evidence_use_forbidden: true,
    source_byte_size: sourceBytes,
    byte_size: buffer.length,
    duration: info.duration,
    actual_duration_seconds: info.duration,
    width: info.width,
    height: info.height,
    codec: info.codec,
    container: info.container,
    sha256: digest,
    actual_sha256: digest,
    transformed_for_edit: true,
    transformation: {
      output_width: 1280,
      output_height: 720,
      aspect_policy: "fit_and_pad",
      loop_short_source_when_required: true,
      codec: "h264",
      crf: 25,
      audio_removed: true,
    },
    approved_for_final_edit: false,
    human_review_status: "PENDING_CLAIM_SPECIFIC_CONTACT_SHEET_REVIEW",
  };
  await writeJsonAtomic(`${output}.provenance.json`, provenance);
  return {
    path: relative,
    scene_id: id,
    provider_asset_id: String(providerAssetId),
    role: item.role || "context",
    claim_id: item.claim_id,
  };
}

export async function acquireSelectedPexels(projectId) {
  const dir = projectDir(projectId);
  const manifest = await readJson(path.join(dir, "research", "selected_pexels_manifest.json"));
  if (manifest.project_id !== projectId) throw new Error("selected Pexels manifest project_id mismatch");
  if (!Array.isArray(manifest.assets) || !manifest.assets.length) throw new Error("selected Pexels manifest has no assets");
  const sceneIds = manifest.assets.map((item) => safeSceneId(item.scene_id));
  if (new Set(sceneIds).size !== sceneIds.length) throw new Error("selected Pexels manifest has duplicate scene ids");

  const usedProviderIds = new Set();
  const records = [];
  const unresolved = [];
  for (const item of manifest.assets) {
    const candidates = (item.provider_asset_ids || []).map(String).filter(Boolean);
    if (!candidates.length) throw new Error(`${item.scene_id}: no provider_asset_ids`);
    let record = null;
    const errors = [];
    for (const candidate of candidates) {
      if (usedProviderIds.has(candidate)) continue;
      try {
        record = await acquireCandidate(projectId, dir, item, candidate);
        usedProviderIds.add(candidate);
        break;
      } catch (error) {
        errors.push({ provider_asset_id: candidate, error: String(error.message || error) });
      }
    }
    if (record) records.push(record);
    else unresolved.push({ scene_id: item.scene_id, claim_id: item.claim_id, errors });
  }

  await fs.rm(path.join(dir, "assets", ".acquisition-tmp"), { recursive: true, force: true });
  await writeJsonAtomic(path.join(dir, "assets", "local_assets.json"), {
    schema_version: 1,
    assets: records.map(({ path: assetPath }) => ({ path: assetPath })),
  });
  await writeJsonAtomic(path.join(dir, "assets", "footage_acquisition.runtime.json"), {
    schema_version: "1.4-selected-public-pexels",
    project_id: projectId,
    generated_at: new Date().toISOString(),
    source: "pexels_public_download",
    license_url: PEXELS_LICENSE,
    planned_asset_count: manifest.assets.length,
    acquired_this_run: records.length,
    reused_existing: 0,
    unresolved_scene_ids: unresolved.map((item) => item.scene_id),
    unresolved,
    records,
    pass: unresolved.length === 0 && records.length === manifest.assets.length,
  });
  return {
    project_id: projectId,
    planned: manifest.assets.length,
    acquired: records.length,
    unresolved: unresolved.length,
    unresolved_scene_ids: unresolved.map((item) => item.scene_id),
    pass: unresolved.length === 0,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const projectId = args["project-id"] || process.env.ORVYQ_PROJECT_ID;
  if (!projectId) throw new Error("--project-id is required");
  acquireSelectedPexels(projectId)
    .then((result) => printJson({ ok: true, ...result }))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
