#!/usr/bin/env node
// Applies an inspected candidate selection.
//
// Takes research/footage_candidate_selection.json -- the choice made against
// the candidate boards -- validates every pick against the shortlist it came
// from, and rewrites the acquisition plan so only the chosen provider assets
// are acquired. A scene where nothing fitted becomes a blocked visual asset
// request rather than an approximate clip.
//
// Candidates that were offered and not taken are left alone. They were never
// judged unfit, so they must stay available to later scenes and later
// rebuilds; only a clip rejected on its own content earns a permanent bar.
import path from "node:path";
import {
  projectDir,
  readJson,
  readJsonSafe,
  writeJsonAtomic,
  parseArgs,
  printJson,
  nowIso,
} from "./lib/fs-utils.mjs";
import { resolveCandidateSelection, unselectedCandidateIds } from "./lib/orvyq-footage-candidates.mjs";

export async function applyFootageCandidateSelection(projectId, { requireComplete = true } = {}) {
  const dir = projectDir(projectId);
  const files = {
    shortlist: path.join(dir, "research", "footage_candidate_shortlist.json"),
    selection: path.join(dir, "research", "footage_candidate_selection.json"),
    plan: path.join(dir, "research", "footage_acquisition_plan.json"),
    requests: path.join(dir, "research", "visual_asset_requests.json"),
  };

  const [shortlist, selection, plan, requests] = await Promise.all([
    readJson(files.shortlist),
    readJson(files.selection),
    readJson(files.plan),
    readJsonSafe(files.requests, null),
  ]);
  if (plan.project_id !== projectId) throw new Error(`footage_acquisition_plan project_id does not match ${projectId}`);

  const resolved = resolveCandidateSelection({ shortlist, selection });
  if (requireComplete && !resolved.complete) {
    throw new Error(
      `${resolved.undecided.length} scene(s) have no inspected decision yet: ${resolved.undecided.join(", ")}`,
    );
  }

  const chosenByScene = new Map(resolved.chosen.map((item) => [item.scene_id, item]));
  const blockedScenes = new Set(resolved.blocked.map((item) => item.scene_id));

  // Pin each scene to the exact asset that was inspected, so acquisition
  // downloads what was chosen instead of searching again and landing
  // somewhere else.
  const assets = [];
  for (const item of plan.assets || []) {
    if (blockedScenes.has(item.scene_id)) continue;
    const chosen = chosenByScene.get(item.scene_id);
    if (!chosen) {
      assets.push(item);
      continue;
    }
    assets.push({
      ...item,
      provider_asset_ids: [chosen.provider_asset_id],
      inspected_selection: {
        provider_asset_id: chosen.provider_asset_id,
        source_page_url: chosen.source_page_url,
        inspection_note: chosen.inspection_note,
        selected_at: nowIso(),
      },
    });
  }

  const nextPlan = {
    ...plan,
    planned_asset_count: assets.length,
    selection_basis: "research/footage_candidate_selection.json",
    assets,
  };

  const writes = [writeJsonAtomic(files.plan, nextPlan)];

  // A blocked scene is a recorded gap, not a silent omission.
  let recordedBlocks = 0;
  if (requests && resolved.blocked.length) {
    const nextRequests = structuredClone(requests);
    const existing = new Set((nextRequests.requests || []).map((request) => request.asset_request_id));
    for (const block of resolved.blocked) {
      const requestId = `REQ_FTG_${block.scene_id.toUpperCase()}_BLOCKED`;
      if (existing.has(requestId)) continue;
      nextRequests.requests.push({
        asset_request_id: requestId,
        type: "contextual_footage",
        status: "pending_direct_asset",
        claim_ids: [block.claim_id],
        scene_ids: [block.scene_id],
        required_source: "a licensed clip whose visible content matches this claim, sourced outside the current provider search",
        required_content: block.reason,
        acceptance:
          "Approved only after four-position contact-sheet inspection confirms the visible content matches this "
          + "claim's narration beat; provider metadata alone is not sufficient.",
        forbidden_substitutes: ["an approximate clip chosen to fill the slot"],
      });
      recordedBlocks += 1;
    }
    if (recordedBlocks) {
      nextRequests.request_revision = Number(nextRequests.request_revision || 1) + 1;
      writes.push(writeJsonAtomic(files.requests, nextRequests));
    }
  }

  await Promise.all(writes);

  return {
    project_id: projectId,
    selected_scene_count: resolved.chosen.length,
    blocked_scene_count: resolved.blocked.length,
    undecided_scene_count: resolved.undecided.length,
    recorded_blocked_requests: recordedBlocks,
    planned_asset_count: assets.length,
    // Reported so it is visible that these were not barred.
    unselected_candidate_count: unselectedCandidateIds({ shortlist, chosen: resolved.chosen }).length,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const projectId = args["project-id"] || args.project;
  if (!projectId) throw new Error("--project-id is required");
  applyFootageCandidateSelection(projectId, { requireComplete: args["allow-incomplete"] !== true })
    .then((result) => printJson({ ok: true, ...result }))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
