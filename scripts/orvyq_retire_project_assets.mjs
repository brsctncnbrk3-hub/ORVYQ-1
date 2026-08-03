#!/usr/bin/env node
// Retires a project's acquired visual assets so the project can be rebuilt
// with fresh ones.
//
// Rebuilding is a real production case: the narration is recorded and the
// topic is settled, but the visuals are to be redone. What must NOT happen is
// the rebuild quietly re-acquiring the same clips -- the provider will happily
// return them, they match the same queries, and nothing downstream would
// notice. So retiring records every retired provider asset id in
// visual_asset_reviews.json's `superseded_assets`, which acquisition treats as
// barred exactly like a rejected asset.
//
// What is deliberately left alone: `voice/voice_script.txt`,
// `assets/audio/final_voice.mp3` and the project's research/claim structure.
// The recorded narration is fixed, and the claim and pause structure is what
// that narration was written and timed against.
import path from "node:path";
import { promises as fs } from "node:fs";
import {
  projectDir,
  readJson,
  readJsonSafe,
  writeJsonAtomic,
  parseArgs,
  printJson,
  nowIso,
  pathExists,
} from "./lib/fs-utils.mjs";

const DEFAULT_REASON =
  "Retired when the project was rebuilt with fresh visuals; the recorded narration and claim structure are unchanged.";

/**
 * Folds every currently known acquired asset into `superseded_assets`,
 * keeping whatever was already retired. Rejected assets stay in
 * `rejected_assets` -- they were never used, and they are already barred.
 */
export function retireVisualAssets(reviews, { runtimeRecords = [], reason = DEFAULT_REASON, at = nowIso() } = {}) {
  const next = structuredClone(reviews);
  next.superseded_assets ||= [];

  const known = new Set(next.superseded_assets.map((asset) => String(asset.provider_asset_id)));
  const byProviderId = new Map();

  for (const asset of next.approved_assets || []) {
    byProviderId.set(String(asset.provider_asset_id), {
      scene_id: asset.scene_id,
      provider_asset_id: String(asset.provider_asset_id),
      ...(asset.asset_path ? { asset_path: asset.asset_path } : {}),
      ...(asset.asset_sha256 ? { asset_sha256: asset.asset_sha256 } : {}),
      ...(asset.approved_uses?.[0]?.claim_id ? { claim_id: asset.approved_uses[0].claim_id } : {}),
    });
  }
  // The runtime is the record of what was actually downloaded, so it catches
  // anything acquired but never carried into an approval.
  for (const record of runtimeRecords) {
    const providerId = String(record.provider_asset_id || "");
    if (!providerId || byProviderId.has(providerId)) continue;
    byProviderId.set(providerId, {
      scene_id: record.scene_id,
      provider_asset_id: providerId,
      ...(record.path ? { asset_path: record.path } : {}),
      ...(record.claim_id ? { claim_id: record.claim_id } : {}),
    });
  }

  const retired = [];
  for (const [providerId, asset] of [...byProviderId.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (known.has(providerId)) continue;
    const entry = { ...asset, reason, superseded_at: at };
    next.superseded_assets.push(entry);
    retired.push(entry);
  }

  next.approved_assets = [];
  next.pending_frame_review_scene_ids = [];
  next.policy = { ...next.policy, superseded_asset_reentry_forbidden: true };
  next.summary = {
    ...next.summary,
    pool_assets: 0,
    pending_frame_review: 0,
    approved: 0,
  };
  next.review_basis =
    "Rebuild in progress: the previous visual pool has been retired and no asset is approved until it passes a fresh four-position contact-sheet review.";
  delete next.completed_at;

  return { reviews: next, retired };
}

/**
 * Clearing the pool and barring its assets are different acts.
 *
 * A rebuild retires footage that was *used*, and that must not come back.
 * Discarding a batch that was picked blind and never inspected is not a
 * judgement on the clips -- barring them would shrink the candidate pool on
 * the strength of a decision nobody ever looked at. `bar: false` clears the
 * pool and leaves those assets available to be offered again.
 */
export async function retireProjectAssets(projectId, { reason = DEFAULT_REASON, deleteMedia = true, bar = true } = {}) {
  const dir = projectDir(projectId);
  const files = {
    reviews: path.join(dir, "research", "visual_asset_reviews.json"),
    runtime: path.join(dir, "assets", "footage_acquisition.runtime.json"),
    contracts: path.join(dir, "research", "footage_use_contracts.json"),
    editorial: path.join(dir, "config", "editorial_asset_plan.json"),
  };

  const [reviews, runtime, contracts, editorial] = await Promise.all([
    readJson(files.reviews),
    readJsonSafe(files.runtime, null),
    readJsonSafe(files.contracts, null),
    readJsonSafe(files.editorial, null),
  ]);
  if (reviews.project_id !== projectId) throw new Error(`visual_asset_reviews project_id does not match ${projectId}`);

  const { reviews: barredReviews, retired } = retireVisualAssets(reviews, {
    runtimeRecords: runtime?.records || [],
    reason,
  });
  const nextReviews = bar
    ? barredReviews
    : { ...barredReviews, superseded_assets: reviews.superseded_assets || [] };

  const removedMedia = [];
  if (deleteMedia) {
    for (const record of runtime?.records || []) {
      for (const relative of [record.path, `${record.path}.provenance.json`]) {
        const target = path.join(dir, relative);
        if (await pathExists(target)) {
          await fs.rm(target);
          removedMedia.push(relative);
        }
      }
    }
  }

  const writes = [writeJsonAtomic(files.reviews, nextReviews)];

  if (runtime) {
    writes.push(writeJsonAtomic(files.runtime, {
      ...runtime,
      generated_at: nowIso(),
      planned_asset_count: 0,
      acquired_this_run: 0,
      reused_existing: 0,
      replacement_scene_ids: [],
      unresolved_scene_ids: [],
      unresolved: [],
      records: [],
    }));
  }
  if (contracts) {
    writes.push(writeJsonAtomic(files.contracts, {
      ...contracts,
      managed_scene_ids: [],
      assignments: [],
      retired_targets: [],
      authored_distribution: undefined,
    }));
  }
  if (editorial) {
    writes.push(writeJsonAtomic(files.editorial, {
      ...editorial,
      footage_assignments: {},
      full_footage_pool: [],
      hook_preloaded_usage: {},
      generation_policy:
        "rebuild in progress: no footage is assigned until a fresh pool is acquired and frame-reviewed, then authored into research/footage_use_contracts.json",
    }));
  }

  await Promise.all(writes);
  return {
    project_id: projectId,
    cleared_provider_asset_count: retired.length,
    barred: bar,
    ...(bar ? { retired_provider_asset_ids: retired.map((asset) => asset.provider_asset_id) } : {}),
    removed_media_file_count: removedMedia.length,
    total_barred_provider_asset_ids:
      (nextReviews.superseded_assets || []).length + (nextReviews.rejected_assets || []).length,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const projectId = args["project-id"] || args.project;
  if (!projectId) throw new Error("--project-id is required");
  retireProjectAssets(projectId, {
    ...(typeof args.reason === "string" ? { reason: args.reason } : {}),
    deleteMedia: args["keep-media"] !== true,
    // --keep-available clears the pool without barring re-entry, for a batch
    // that was never inspected on its merits.
    bar: args["keep-available"] !== true,
  })
    .then((result) => printJson({ ok: true, ...result }))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
