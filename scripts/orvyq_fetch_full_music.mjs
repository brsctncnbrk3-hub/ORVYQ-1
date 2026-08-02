#!/usr/bin/env node
// Acquires the exact licensed tracks declared by the selected project's
// config/music_acquisition.json. The system contains no artist, track, cue,
// URL, or license choice: those are project data. This script only validates,
// downloads, probes, registers and attributes the declared music. Cue status
// is synchronized when a project cue sheet already exists; acquisition itself
// may safely happen before the shot-derived cue sheet is generated.
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  REPO_ROOT,
  projectDir,
  readJson,
  readJsonSafe,
  writeJsonAtomic,
  parseArgs,
  printJson,
} from "./lib/fs-utils.mjs";
import { resolveProjectId } from "./lib/orvyq-project-profile.mjs";
import { intakeMusicTrack } from "./orvyq_music_intake.mjs";
import { downloadWithRetry } from "./orvyq_fetch_music.mjs";

const exec = promisify(execFile);
const LICENSE_SNAPSHOT_DIR = path.join(REPO_ROOT, "music_library", "license_snapshots");
const TRACK_ID_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const FAMILY_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

export function validateMusicAcquisitionPlan(plan, projectId = plan?.project_id) {
  if (!plan || typeof plan !== "object") throw new Error("Music acquisition plan must be a JSON object");
  if (plan.project_id !== projectId) throw new Error(`Music acquisition plan project_id ${plan.project_id} does not match ${projectId}`);
  if (plan.status !== "ready") throw new Error(`Music acquisition plan is not ready (status=${plan.status || "missing"})`);
  for (const key of ["artist", "license_name", "license_url", "attribution_template"]) {
    if (!String(plan[key] || "").trim()) throw new Error(`Music acquisition plan requires ${key}`);
  }
  if (!Array.isArray(plan.tracks) || !plan.tracks.length) throw new Error("Music acquisition plan requires at least one track");
  const cueIds = new Set();
  const trackIds = new Set();
  const families = new Set();
  for (const [index, track] of plan.tracks.entries()) {
    for (const key of ["cue_id", "track_id", "title", "composition_family", "source_page_url", "download_url"]) {
      if (!String(track?.[key] || "").trim()) throw new Error(`tracks[${index}].${key} is required`);
    }
    if (!TRACK_ID_PATTERN.test(track.track_id)) throw new Error(`Invalid track_id ${track.track_id}`);
    if (!FAMILY_PATTERN.test(track.composition_family)) throw new Error(`Invalid composition_family ${track.composition_family}`);
    if (!String(track.source_page_url).startsWith("https://")) throw new Error(`${track.track_id} source_page_url must use HTTPS`);
    if (!String(track.download_url).startsWith("https://")) throw new Error(`${track.track_id} download_url must use HTTPS`);
    if (cueIds.has(track.cue_id)) throw new Error(`Duplicate cue_id in music acquisition plan: ${track.cue_id}`);
    if (trackIds.has(track.track_id)) throw new Error(`Duplicate track_id in music acquisition plan: ${track.track_id}`);
    cueIds.add(track.cue_id);
    trackIds.add(track.track_id);
    families.add(track.composition_family);
  }
  if (families.size !== 1) {
    throw new Error(`Music acquisition plan must declare one composition family; found ${[...families].join(", ")}`);
  }
  return plan;
}

export function attributionFor(plan, title) {
  return String(plan.attribution_template)
    .replaceAll("{title}", title)
    .replaceAll("{artist}", plan.artist)
    .replaceAll("{license_name}", plan.license_name)
    .replaceAll("{license_url}", plan.license_url);
}

async function loadMusicAcquisitionPlan(projectId) {
  const plan = await readJson(path.join(projectDir(projectId), "config", "music_acquisition.json"));
  return validateMusicAcquisitionPlan(plan, projectId);
}

async function probe(file) {
  const { stdout } = await exec("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration:stream=codec_name,codec_type,sample_rate,channels",
    "-of", "json",
    file,
  ]);
  const parsed = JSON.parse(stdout);
  const duration = Number.parseFloat(parsed.format?.duration);
  const audioStream = (parsed.streams || []).find((stream) => stream.codec_type === "audio");
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Could not determine duration for ${file}`);
  if (!audioStream?.codec_name) throw new Error(`Could not determine audio codec for ${file}`);
  return {
    duration,
    codec: audioStream.codec_name,
    sampleRate: Number(audioStream.sample_rate) || null,
    channels: Number(audioStream.channels) || null,
  };
}

async function snapshotLicensePage(track) {
  await mkdir(LICENSE_SNAPSHOT_DIR, { recursive: true });
  const bytes = await downloadWithRetry(track.source_page_url, {
    redirect: "follow",
    headers: { "User-Agent": "ORVYQ documentary system/1.0", Accept: "text/html" },
  });
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const htmlPath = path.join(LICENSE_SNAPSHOT_DIR, `${track.track_id}.page.html`);
  await writeFile(htmlPath, bytes);
  const record = {
    track_id: track.track_id,
    source_page_url: track.source_page_url,
    snapshot_path: path.relative(REPO_ROOT, htmlPath).split(path.sep).join("/"),
    sha256,
    bytes: bytes.length,
    captured_at: new Date().toISOString(),
  };
  await writeJsonAtomic(path.join(LICENSE_SNAPSHOT_DIR, `${track.track_id}.page.json`), record);
  return record;
}

async function acquireOneTrack(plan, track) {
  const temp = await mkdtemp(path.join(os.tmpdir(), "orvyq-music-fetch-"));
  try {
    const licenseSnapshot = await snapshotLicensePage(track);
    const bytes = await downloadWithRetry(track.download_url, {
      redirect: "follow",
      headers: {
        "User-Agent": "ORVYQ documentary system/1.0",
        Referer: track.source_page_url,
        Accept: "audio/mpeg,audio/*;q=0.9,*/*;q=0.5",
      },
    });
    if (bytes.length < 100_000) throw new Error(`${track.track_id}: download is unexpectedly small (${bytes.length} bytes)`);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const downloadPath = path.join(temp, `${track.track_id}.mp3`);
    await writeFile(downloadPath, bytes);
    const probed = await probe(downloadPath);
    const entry = await intakeMusicTrack({
      sourceFile: downloadPath,
      trackId: track.track_id,
      title: track.title,
      artist: plan.artist,
      compositionFamily: track.composition_family,
      sourcePageUrl: track.source_page_url,
      licenseName: plan.license_name,
      licenseUrl: plan.license_url,
      attribution: attributionFor(plan, track.title),
      acquisitionProvenance: `Downloaded from the project-declared licensed source (${track.download_url}); source/license page snapshot recorded at ${licenseSnapshot.snapshot_path} (sha256 ${licenseSnapshot.sha256}).`,
      approvedForProof: track.approved_for_proof === true,
      approvedForFull: track.approved_for_full === true,
      status: "approved",
      notes: track.notes || null,
    });
    return {
      cue_id: track.cue_id,
      track_id: track.track_id,
      composition_family: track.composition_family,
      sha256,
      bytes: bytes.length,
      ...probed,
      license_snapshot: licenseSnapshot,
      registry_entry: entry,
    };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

async function markCueReadyIfPresent(projectId, cueId, trackId) {
  const dir = projectDir(projectId);
  const cueSheetPath = path.join(dir, "direction", "music_cue_sheet.json");
  const cueSheet = await readJsonSafe(cueSheetPath, null);
  if (!cueSheet) return false;
  const cues = cueSheet.full_cues || cueSheet.cues || [];
  const cue = cues.find((entry) => entry.cue_id === cueId);
  if (!cue) return false;
  if (cue.track_id !== trackId) throw new Error(`${cueId} declares track_id ${cue.track_id}, expected ${trackId}`);
  cue.status = "ready";
  await writeJsonAtomic(cueSheetPath, cueSheet);
  return true;
}

async function writeConsolidatedAttribution(projectId, plan, results) {
  const dir = projectDir(projectId);
  const byTrackId = new Map(plan.tracks.map((track) => [track.track_id, track]));
  const uniqueTrackIds = [...new Set(results.map((result) => result.track_id))];
  const lines = [
    "Music",
    ...uniqueTrackIds.map((trackId) => attributionFor(plan, byTrackId.get(trackId).title)),
  ];
  const outputPath = path.join(dir, "assets", "music", "youtube_description_attribution.txt");
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, lines.join("\n") + "\n");
  return path.relative(REPO_ROOT, outputPath).split(path.sep).join("/");
}

export async function fetchAndVendorFullMusicPackage(projectId) {
  const plan = await loadMusicAcquisitionPlan(projectId);
  const results = [];
  const cuesMarkedReady = [];
  for (const track of plan.tracks) {
    const result = await acquireOneTrack(plan, track);
    if (await markCueReadyIfPresent(projectId, track.cue_id, track.track_id)) {
      cuesMarkedReady.push(track.cue_id);
    }
    results.push(result);
  }
  const attributionPath = await writeConsolidatedAttribution(projectId, plan, results);
  return {
    project_id: projectId,
    tracks: results.length,
    composition_family: results[0]?.composition_family || null,
    cues_marked_ready: cuesMarkedReady,
    cue_sheet_pending_generation: cuesMarkedReady.length === 0,
    attribution_file: attributionPath,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  let projectId;
  try {
    projectId = resolveProjectId(args);
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message, code: error.code }));
    process.exitCode = 1;
  }
  if (projectId) {
    fetchAndVendorFullMusicPackage(projectId)
      .then((result) => printJson({ ok: true, ...result }))
      .catch((error) => {
        console.error(JSON.stringify({ ok: false, error: error.message }));
        process.exitCode = 1;
      });
  }
}
