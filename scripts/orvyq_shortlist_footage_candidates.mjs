#!/usr/bin/env node
// Builds the candidate board a scene is chosen from.
//
// For each planned scene this searches the provider, keeps the top N
// licensable candidates, and tiles their poster frames -- which the search
// response already carries -- into one inspectable board per scene. No video
// is downloaded: the point is to see the options before committing to one.
//
// Pair with orvyq_apply_footage_candidate_selection.mjs, which takes the
// authored choice and acquires only the chosen clip.
import path from "node:path";
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import {
  projectDir,
  readJson,
  readJsonSafe,
  writeJsonAtomic,
  parseArgs,
  printJson,
  nowIso,
} from "./lib/fs-utils.mjs";
import {
  searchPexels,
  fetchPexelsVideo,
  shortlistCandidates,
  collectRejectedProviderAssetIds,
} from "./orvyq_acquire_footage_demand.mjs";
import {
  activeFootageCandidateGaps,
  buildSceneShortlist,
  buildShortlistDocument,
  prioritizeCuratedCandidates,
} from "./lib/orvyq-footage-candidates.mjs";

const DEFAULT_CANDIDATES_PER_SCENE = 6;

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${command} failed: ${stderr.slice(-400)}`))));
  });
}

async function fetchPoster(url, target) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`poster fetch failed (${response.status}) for ${url}`);
  await fs.writeFile(target, Buffer.from(await response.arrayBuffer()));
}

/**
 * One board per scene: every candidate's poster frame, in rank order, so the
 * scene is judged on what the clips look like rather than what they are
 * called.
 */
async function buildBoard({ sceneId, candidates, workDir, boardPath }) {
  const posters = [];
  for (const [index, candidate] of candidates.entries()) {
    if (!candidate.poster_url) continue;
    const target = path.join(workDir, `${sceneId}_${String(index + 1).padStart(2, "0")}.jpg`);
    try {
      await fetchPoster(candidate.poster_url, target);
      posters.push(target);
    } catch {
      // A candidate whose poster cannot be fetched simply cannot be inspected,
      // so it must not reach the board and be chosen sight unseen.
      candidate.poster_url = null;
    }
  }
  if (!posters.length) return { built: false, inspectable: 0 };

  // Normalise every poster to one cell size, chain them into a single stream,
  // then tile. `tile` takes one input, so the posters have to be concatenated
  // first. Cells read left to right, top to bottom, in the shortlist's own
  // rank order, which is how a candidate is referred to when it is chosen.
  const columns = Math.min(3, posters.length);
  const rows = Math.ceil(posters.length / columns);
  const scaled = posters
    .map((_, index) =>
      `[${index}:v]scale=640:360:force_original_aspect_ratio=decrease,`
      + `pad=640:360:(ow-iw)/2:(oh-ih)/2:black,setsar=1[v${index}]`)
    .join(";");
  const chain = posters.map((_, index) => `[v${index}]`).join("");
  await run("ffmpeg", [
    "-y",
    ...posters.flatMap((poster) => ["-i", poster]),
    "-filter_complex",
    `${scaled};${chain}concat=n=${posters.length}:v=1:a=0[s];[s]tile=${columns}x${rows}:padding=6:color=black[out]`,
    "-map", "[out]",
    "-frames:v", "1",
    boardPath,
  ]);
  return { built: true, inspectable: posters.length };
}

export async function shortlistFootageCandidates(
  projectId,
  { candidatesPerScene = DEFAULT_CANDIDATES_PER_SCENE, replacementOnly = false } = {},
) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) throw new Error("PEXELS_API_KEY is required to search for candidates");

  const dir = projectDir(projectId);
  const plan = await readJson(path.join(dir, "research", "footage_acquisition_plan.json"));
  const runtime = await readJsonSafe(path.join(dir, "assets", "footage_acquisition.runtime.json"), { records: [] });
  const semantic = await readJsonSafe(path.join(dir, "research", "footage_semantic_constraints.json"), { scenes: {} });
  const reviews = await readJsonSafe(path.join(dir, "research", "visual_asset_reviews.json"), { rejected_assets: [] });
  if (plan.project_id !== projectId) throw new Error(`footage_acquisition_plan project_id does not match ${projectId}`);

  const barred = collectRejectedProviderAssetIds(semantic, reviews);
  const activeGaps = activeFootageCandidateGaps({ plan, runtime, rejectedProviderAssetIds: barred });
  const replacementSceneIds = new Set(activeGaps.map((item) => item.scene_id));
  const plannedAssets = replacementOnly
    ? (plan.assets || []).filter((item) => replacementSceneIds.has(item.scene_id))
    : (plan.assets || []);
  if (replacementOnly && !plannedAssets.length) {
    throw new Error("--replacement-only requested, but no currently pinned provider asset is rejected");
  }
  const boardsDir = path.join(dir, "qa", "footage-candidate-boards");
  const workDir = path.join(dir, "qa", ".candidate-posters");
  await fs.rm(boardsDir, { recursive: true, force: true });
  await fs.mkdir(boardsDir, { recursive: true });
  await fs.mkdir(workDir, { recursive: true });

  const policy = plan.policy || {};
  const perPage = Math.max(1, Math.min(80, Number(policy.results_per_query || 50)));
  const scenes = [];
  const withoutCandidates = [];

  for (const item of plannedAssets) {
    const constraint = semantic.scenes?.[item.scene_id] || {};
    const queries = [...new Set([...(item.queries || []), ...(item.fallback_queries || [])])];
    const videosById = new Map();
    const curatedProviderAssetIds = [...new Set(
      (item.curated_provider_asset_ids || []).map(String).map((id) => id.trim()).filter(Boolean),
    )];
    for (const providerAssetId of curatedProviderAssetIds) {
      let result;
      try {
        result = await fetchPexelsVideo(providerAssetId, key);
      } catch (error) {
        throw new Error(
          `${item.scene_id}: curated Pexels video ${providerAssetId} is unavailable: ${error.message}`,
        );
      }
      videosById.set(String(result.video.id), result.video);
    }
    for (const query of queries) {
      const result = await searchPexels(query, key, perPage, 1, {});
      for (const video of result?.videos || []) videosById.set(String(video.id), video);
    }

    const eligible = shortlistCandidates(
      [...videosById.values()],
      new Set(),
      {
        ...item,
        rejected_provider_asset_ids: [...new Set([
          ...barred,
          ...((item.rejected_provider_asset_ids || []).map(String)),
        ])],
      },
      queries.join(" "),
    );
    const ranked = prioritizeCuratedCandidates(eligible, curatedProviderAssetIds, candidatesPerScene);

    const scene = buildSceneShortlist({
      sceneId: item.scene_id,
      claimId: item.claim_id,
      requiredVisibleContent: constraint.required_visible_content || item.editorial_note || "",
      queries,
      candidates: ranked,
      limit: candidatesPerScene,
    });

    const boardPath = path.join(boardsDir, `${item.scene_id}.jpg`);
    const board = await buildBoard({
      sceneId: item.scene_id,
      candidates: scene.candidates,
      workDir,
      boardPath,
    });
    scene.candidate_board = board.built ? path.relative(dir, boardPath).split(path.sep).join("/") : null;
    scene.inspectable_candidate_count = board.inspectable;
    if (!board.inspectable) withoutCandidates.push(item.scene_id);
    scenes.push(scene);
  }

  await fs.rm(workDir, { recursive: true, force: true });

  const document = buildShortlistDocument({
    projectId,
    scenes,
    limit: candidatesPerScene,
    generatedAt: nowIso(),
    selectionScope: replacementOnly ? { mode: "active_gaps", gaps: activeGaps } : { mode: "full_plan" },
  });
  await writeJsonAtomic(path.join(dir, "research", "footage_candidate_shortlist.json"), document);
  await writeJsonAtomic(path.join(dir, "research", "footage_candidate_selection.json"), {
    schema_version: "1.0",
    project_id: projectId,
    shortlist_generated_at: document.generated_at,
    selection_status: "inspection_required",
    selections: [],
  });

  return {
    project_id: projectId,
    scene_count: scenes.length,
    candidates_per_scene: candidatesPerScene,
    total_candidates: scenes.reduce((sum, scene) => sum + scene.candidate_count, 0),
    scenes_without_inspectable_candidates: withoutCandidates,
    selection_scope: document.selection_scope,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const projectId = args["project-id"] || args.project;
  if (!projectId) throw new Error("--project-id is required");
  shortlistFootageCandidates(projectId, {
    candidatesPerScene: Number(args["candidates-per-scene"] || DEFAULT_CANDIDATES_PER_SCENE),
    replacementOnly: args["replacement-only"] === true,
  })
    .then((result) => printJson({ ok: true, ...result }))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
