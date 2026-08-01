#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  projectDir,
  pathExists,
  writeJsonAtomic,
  parseArgs,
  printJson,
  nowIso,
} from "./lib/fs-utils.mjs";
import { resolveProjectId } from "./lib/orvyq-project-profile.mjs";

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function deriveEditorialRhythm(durationMinutes) {
  const minutes = Number.isFinite(Number(durationMinutes)) ? Number(durationMinutes) : 12;
  let fullPauseTarget = clamp(Math.round(minutes / 5), 2, 5);
  let briefAccentTarget = clamp(Math.round(minutes / 3.5), 2, 7);
  while (fullPauseTarget + briefAccentTarget > 12) briefAccentTarget -= 1;
  return {
    full_pause_target: fullPauseTarget,
    brief_accent_target: briefAccentTarget,
    brief_accent_minimum_seconds: 1.5,
    brief_accent_maximum_seconds: 3,
  };
}

export function buildScaffoldManifest({ projectId, title, durationMinutes = 12 }) {
  const createdAt = nowIso();
  return {
    "project.json": {
      schema_version: "1.0",
      project_id: projectId,
      title,
      status: "intake",
      created_at: createdAt,
      target_duration_minutes: Number(durationMinutes),
    },
    "config/project_config.json": {
      schema_version: "1.0",
      project_id: projectId,
      project_name: title,
      created_at: createdAt,
      status: "intake",
    },
    "config/video_config.json": {
      fps: 30,
      width: 1920,
      height: 1080,
    },
    "config/production_profile.json": {
      schema_version: "1.0",
      project_id: projectId,
      status: "needs_editorial_input",
      creative_profile: "orvyq-aperture-cinematic",
      visual_medium_balance: {
        contextual_footage_fraction_min: 0.60,
        contextual_footage_fraction_max: 0.70,
        primary_evidence_fraction_min: 0.20,
        graphic_card_fraction_max: 0.15,
        full_screen_text_card_fraction_max: 0.03,
        section_graphic_card_fraction_max: 0.25,
        maximum_consecutive_graphic_card_shots: 1,
        maximum_graphic_template_uses: 3,
        maximum_full_screen_template_uses: 2,
        project_overrides_may_only_tighten: true,
      },
      art_direction: {
        topic: null,
        palette: {
          ink: "#F5F0E7",
          accent: "#D95B53",
          information: "#86A9CC",
          ground: "#07101A",
        },
        source_treatment: "full-screen primary evidence and explicitly source-derived graphics",
      },
      end_card: {
        title: null,
        subtitle: null,
      },
      proof: {
        boundary_anchor_text: null,
      },
      hook: {
        first_shot_role: "human_context",
        first_shot_asset: null,
        target_cut_count: 4,
        target_duration_seconds: 11,
        question_minimum_characters: 35,
        question_maximum_characters: 100,
      },
      editorial_rhythm: deriveEditorialRhythm(durationMinutes),
      opening_evidence: {
        kind: "official_document",
        target_asset_count: 1,
      },
      creative_polish: {
        require_repetition_reduction: false,
        source_review_run_id: null,
        footage_replacements: [],
      },
    },
    "config/editorial_asset_plan.json": {
      schema_version: "1.0",
      project_id: projectId,
      status: "needs_editorial_input",
      footage_assignments: {},
      graphic_break_assignments: {},
      full_footage_pool: [],
      hook_preloaded_usage: {},
      slice_count_overrides: {},
    },
    "config/music_acquisition.json": {
      schema_version: "1.0",
      project_id: projectId,
      status: "needs_music_selection",
      artist: null,
      license_name: null,
      license_url: null,
      attribution_template: null,
      tracks: [],
    },
    "direction/project_brief.json": {
      schema_version: "1.0",
      project_id: projectId,
      title,
      central_question: null,
      audience_promise: null,
      emotional_arc: [],
      status: "needs_editorial_input",
    },
    "research/research_brief.json": {
      schema_version: "1.0",
      project_id: projectId,
      research_question: null,
      required_primary_sources: [],
      claims: [],
      status: "needs_research",
    },
    "research/visual_asset_reviews.json": {
      schema_version: "1.0",
      project_id: projectId,
      review_basis: "Fail-closed claim-specific footage review registry.",
      policy: {
        default_status_for_unlisted_assets: "pending_frame_review",
        rejected_asset_global_reentry_forbidden: true,
        automatic_backfill_forbidden: true,
        approval_requires_contact_sheet_sha256: true,
        approval_requires_claim_id_narration_anchor_and_semantic_rationale: true,
      },
      summary: {
        pool_assets: 0,
        rejected_from_metadata: 0,
        pending_frame_review: 0,
        approved: 0,
      },
      pending_frame_review_scene_ids: [],
      rejected_assets: [],
      approved_assets: [],
    },
  };
}

export async function createNewProject({ projectId, title, durationMinutes = 12 }) {
  const dir = projectDir(projectId);
  if (await pathExists(dir)) throw new Error(`Project already exists: ${projectId}`);

  const manifest = buildScaffoldManifest({ projectId, title, durationMinutes });
  for (const [relativePath, contents] of Object.entries(manifest)) {
    await writeJsonAtomic(path.join(dir, relativePath), contents);
  }
  for (const relativeDir of [
    "assets/audio",
    "assets/evidence",
    "assets/footage",
    "assets/music",
    "assets/sfx",
    "direction",
    "qa",
    "remotion",
    "research",
    "voice",
  ]) {
    const target = path.join(dir, relativeDir);
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, ".gitkeep"), "", "utf8");
  }
  await fs.writeFile(path.join(dir, "voice", "voice_script.txt"), "", "utf8");
  return {
    project_id: projectId,
    project_directory: path.relative(process.cwd(), dir),
    status: "needs_editorial_input",
    created_files: Object.keys(manifest),
    next_required_inputs: [
      "research/research_brief.json",
      "direction/project_brief.json",
      "config/production_profile.json",
      "config/editorial_asset_plan.json",
      "config/music_acquisition.json",
      "voice/voice_script.txt",
    ],
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
    const title = String(args.title || "").trim();
    if (!title) {
      console.error(JSON.stringify({ ok: false, error: "--title is required" }));
      process.exitCode = 1;
    } else {
      createNewProject({
        projectId,
        title,
        durationMinutes: Number(args["duration-minutes"] || 12),
      })
        .then((result) => printJson({ ok: true, ...result }))
        .catch((error) => {
          console.error(JSON.stringify({ ok: false, error: error.message }));
          process.exitCode = 1;
        });
    }
  }
}
