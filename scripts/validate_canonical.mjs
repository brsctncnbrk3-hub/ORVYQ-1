// Project-independent canonical schema validation.
//
// Real-data checks discover every projects/*/config/production_profile.json
// whose status is "ready". Draft scaffolds are deliberately excluded from
// production validation until their editorial/research inputs are complete.
// Generic fixtures prove output-schema usability without importing claims,
// assets, titles, or identifiers from any real film.
import path from "node:path";
import fs from "node:fs";
import { loadCanonicalAjv, readJson } from "./lib/schema-validate.mjs";

const PROJECTS_DIR = path.resolve("projects");
const FIXTURE_PROJECT_ID = "000-example-project";
const ajv = loadCanonicalAjv();
const results = [];

function check(label, schemaFile, data, { kind }) {
  const validate = ajv.getSchema(schemaFile);
  if (!validate) throw new Error(`Unknown schema: ${schemaFile}`);
  const ok = validate(data);
  results.push({ label, schemaFile, kind, ok, errors: ok ? [] : validate.errors });
}

function readJsonIfExists(file) {
  return fs.existsSync(file) ? readJson(file) : null;
}

function readyProjects() {
  if (!fs.existsSync(PROJECTS_DIR)) return [];
  const discovered = [];
  for (const entry of fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
    const directory = path.join(PROJECTS_DIR, entry.name);
    const profilePath = path.join(directory, "config", "production_profile.json");
    if (!fs.existsSync(profilePath)) continue;
    const profile = readJson(profilePath);
    if (profile.project_id !== entry.name) {
      results.push({
        label: `${entry.name}/config/production_profile.json`,
        schemaFile: "project identity",
        kind: "real",
        ok: false,
        errors: [{ message: `project_id ${profile.project_id} does not match directory ${entry.name}` }],
      });
      continue;
    }
    if (profile.status === "ready") discovered.push({ id: entry.name, directory, profile });
  }
  return discovered;
}

function requireRealJson(project, relativePath, schemaFile) {
  const absolute = path.join(project.directory, relativePath);
  if (!fs.existsSync(absolute)) {
    results.push({
      label: `${project.id}/${relativePath}`,
      schemaFile,
      kind: "real",
      ok: false,
      errors: [{ message: "required file is missing for a ready project" }],
    });
    return null;
  }
  const data = readJson(absolute);
  check(`${project.id}/${relativePath}`, schemaFile, data, { kind: "real" });
  return data;
}

function validateReadyProject(project) {
  const pauseMap = requireRealJson(project, "direction/editorial_pause_map.json", "editorial_pauses.schema.json");
  const musicCueSheet = requireRealJson(project, "direction/music_cue_sheet.json", "music_cues.schema.json");
  const sequencePlan = requireRealJson(project, "direction/sequence_plan.json", "sequence_plan.schema.json");
  void pauseMap;
  void musicCueSheet;
  void sequencePlan;

  const videoConfig = readJsonIfExists(path.join(project.directory, "config", "video_config.json"));
  const projectConfig = readJsonIfExists(path.join(project.directory, "config", "project_config.json"))
    || readJsonIfExists(path.join(project.directory, "project.json"));
  const blueprint = readJsonIfExists(path.join(project.directory, "direction", "editorial_blueprint.json"));
  if (!videoConfig || !projectConfig || !blueprint?.full_production?.generated_total_duration_seconds) {
    results.push({
      label: `${project.id}/canonical project assembly`,
      schemaFile: "canonical_project.schema.json",
      kind: "real",
      ok: false,
      errors: [{ message: "ready project needs video config, project metadata, and generated full-production duration" }],
    });
  } else {
    const canonicalProject = {
      schema_version: "1.0-canonical",
      project_id: project.id,
      title: projectConfig.project_name || projectConfig.title,
      fps: videoConfig.fps,
      width: videoConfig.width,
      height: videoConfig.height,
      duration_frames: Math.round(blueprint.full_production.generated_total_duration_seconds * videoConfig.fps),
      brand: {
        name: "ORVYQ",
        tagline: "Beyond the Known",
        palette: { ink: "#F3ECDD", signal: "#D84B4B", ground: "#05070C" },
      },
      created_at: projectConfig.created_at,
    };
    check(`${project.id}/canonical project assembly`, "canonical_project.schema.json", canonicalProject, { kind: "real" });
  }

  const optionalGenerated = [
    ["direction/edit_plan.json", "edit_plan.schema.json"],
    ["remotion/captions.json", "captions.schema.json"],
    ["assets/audio/final_mix.metadata.json", "audio_mix.schema.json"],
    ["assets/asset_registry.json", "asset_registry.schema.json"],
    ["qa/frozen_candidate.json", "frozen_candidate.schema.json"],
    ["qa/proof_approval.json", "proof_approval.schema.json"],
    ["voice/narration_alignment.json", "narration_alignment.schema.json"],
    ["direction/resolved_pause_plan.json", "resolved_pause_plan.schema.json"],
  ];
  for (const [relativePath, schemaFile] of optionalGenerated) {
    const absolute = path.join(project.directory, relativePath);
    if (fs.existsSync(absolute)) {
      check(`${project.id}/${relativePath}`, schemaFile, readJson(absolute), { kind: "real generated" });
    }
  }
  const optionalVisualContracts = [
    ["direction/visual_rebalance_plan.json", "visual_rebalance_plan.schema.json"],
    ["research/visual_asset_requests.json", "visual_asset_requests.schema.json"],
    ["research/visual_asset_reviews.json", "visual_asset_reviews.schema.json"],
  ];
  for (const [relativePath, schemaFile] of optionalVisualContracts) {
    const absolute = path.join(project.directory, relativePath);
    if (fs.existsSync(absolute)) {
      check(`${project.id}/${relativePath}`, schemaFile, readJson(absolute), { kind: "real visual contract" });
    }
  }
}

for (const project of readyProjects()) validateReadyProject(project);

// ---- Generic fixtures: schema shape proof only ----
const fixtureFootageShot = {
  shot_id: "shot_002",
  scene_id: "scene_001",
  start_frame: 90,
  end_frame: 270,
  transition_in: "cut",
  transition_out: "cut",
  text_overlay: null,
  claim_id: "CLM_FIXTURE_CONTEXT",
  visual_role: "context",
  editorial_purpose: "Establish the physical setting for the narrated claim.",
  narration_anchor: "The documented setting establishes the physical context.",
  semantic_rationale: "The visible working environment directly establishes the physical context named by narration.",
  semantic_link: "physical",
  asset_type: "footage",
  video_asset: "assets/footage/context-a.mp4",
  trim_in_sec: 1,
  trim_out_sec: 7,
};
check("generic fixture footage shot", "shot.schema.json", fixtureFootageShot, { kind: "fixture" });

const fixtureGraphicShot = {
  shot_id: "shot_001",
  scene_id: "scene_001",
  start_frame: 0,
  end_frame: 90,
  transition_in: "fade",
  transition_out: "cut",
  text_overlay: null,
  claim_id: "CLM_FIXTURE_QUESTION",
  visual_role: "graphic",
  editorial_purpose: "State the central question before the evidence sequence.",
  narration_anchor: "The film opens by asking one unresolved question.",
  semantic_rationale: "The concise question card states the exact conceptual problem that the narration introduces.",
  semantic_link: "conceptual",
  asset_type: "graphic",
  graphic: {
    type: "brand_open",
    kicker: "ORVYQ PRESENTS",
    title: "AN UNRESOLVED QUESTION",
    subtitle: "A source-led cinematic documentary",
  },
  sound_cue: "pulse",
};
check("generic fixture graphic shot", "shot.schema.json", fixtureGraphicShot, { kind: "fixture" });

const fixtureEditPlan = {
  schema_version: "1.0-canonical",
  project_id: FIXTURE_PROJECT_ID,
  mode: "candidate",
  frame_range: { start_frame: 0, end_frame: 1800 },
  fps: 30,
  duration_frames: 1800,
  audio_mix_asset: "assets/audio/final_mix.mp3",
  brand: {
    name: "ORVYQ",
    tagline: "Beyond the Known",
    palette: { ink: "#F3ECDD", signal: "#D84B4B", ground: "#05070C" },
  },
  blacklisted_assets: [],
  shots: [fixtureGraphicShot, fixtureFootageShot],
  quality_policy: {},
};
check("generic fixture edit plan", "edit_plan.schema.json", fixtureEditPlan, { kind: "fixture" });
check(
  "generic fixture timeline",
  "timeline.schema.json",
  { fps: 30, duration_frames: 1800, blacklisted_assets: [], shots: [fixtureGraphicShot, fixtureFootageShot] },
  { kind: "fixture" },
);

const fixtureCaptions = {
  schema_version: "1.0-canonical",
  style: {
    placement: "bottom_safe",
    line_count: 1,
    max_words: 7,
    max_chars: 52,
    font_size_px: 36,
    background: "none",
  },
  alignment: { recognized_words: 120, aligned_script_words: 116, mapped_words: 116, score: 0.96 },
  captions: [{
    caption_id: "cap_001",
    scene_id: "scene_001",
    start_frame: 90,
    end_frame: 180,
    text: "The evidence begins with a simple question",
  }],
};
check("generic fixture captions", "captions.schema.json", fixtureCaptions, { kind: "fixture" });

const fixtureAudioMix = {
  schema_version: "1.0-canonical",
  mode: "candidate",
  duration_seconds: 60,
  narration_duration_seconds: 52,
  pause_windows: [{ pause_id: "PAUSE_01", start_seconds: 24, end_seconds: 28 }],
  music_sections: [{ id: "opening", start_seconds: 0, end_seconds: 60 }],
  sfx_placements: [{ sfx_id: "tonal_bloom", at_seconds: 24 }],
  narration_ducking: { enabled: true },
  licensing: "Licensed or original audio, verified by provenance",
  measured: { integrated_lufs: -16, true_peak_dbtp: -1.5, loudness_range: 6 },
};
check("generic fixture audio mix", "audio_mix.schema.json", fixtureAudioMix, { kind: "fixture" });

const fixtureAssetRegistry = {
  schema_version: "1.0-canonical",
  project_id: FIXTURE_PROJECT_ID,
  assets: [{
    asset_id: "context_a",
    type: "footage",
    path: "assets/footage/context-a.mp4",
    source: "licensed-provider",
    source_url: "https://example.com/source/context-a",
    license: "https://example.com/license",
    attribution: "",
    duration_seconds: 12,
    width: 1920,
    height: 1080,
    sha256: "a".repeat(64),
    semantic_keywords: ["human", "context"],
    editorial_roles: ["context"],
    allowed_reuse_count: 2,
  }],
};
check("generic fixture asset registry", "asset_registry.schema.json", fixtureAssetRegistry, { kind: "fixture" });

const fixtureEvidenceRegistry = {
  schema_version: "1.0-canonical",
  project_id: FIXTURE_PROJECT_ID,
  sources: [{
    source_id: "SRC_PRIMARY_01",
    publisher: "Example Institution",
    title: "Primary Source Document",
    publication_date: "2026-01-01",
    url: "https://example.com/primary-source.pdf",
    source_type: "primary_research",
    official: true,
  }],
  claims: [{
    claim_id: "CLM_001",
    section_id: "SEC_01",
    importance: 5,
    narration_excerpt: "The primary source establishes the central documented fact.",
    status: "verified",
    source_ids: ["SRC_PRIMARY_01"],
  }],
  evidence_assets: [{
    evidence_asset_id: "EVID_PRIMARY_01",
    claim_ids: ["CLM_001"],
    source_ids: ["SRC_PRIMARY_01"],
    mode: "official_primary_capture",
    status: "ready",
    required_for_proof: true,
    required_for_full: true,
  }],
};
check("generic fixture evidence registry", "evidence_registry.schema.json", fixtureEvidenceRegistry, { kind: "fixture" });

const fixtureIdentity = {
  project_id: FIXTURE_PROJECT_ID,
  source_commit_sha: "0".repeat(40),
  renderer_version: "templates/remotion@1.0.0",
  timeline_hash: "0".repeat(64),
  edit_plan_hash: "0".repeat(64),
  caption_hash: "0".repeat(64),
  audio_mix_metadata_hash: "0".repeat(64),
  asset_registry_hash: "0".repeat(64),
  render_bundle_hash: "2".repeat(64),
  selected_render_range: { start_frame: 0, end_frame: 1800 },
  fps: 30,
  total_frames: 1800,
  mode: "candidate",
};
const fixtureFrozenCandidate = {
  project_id: FIXTURE_PROJECT_ID,
  canonical_candidate_identity: fixtureIdentity,
  candidate_hash: "1".repeat(64),
  render_bundle_hash: "2".repeat(64),
  operational_metadata: {
    created_at: "2026-01-01T00:00:00Z",
    approval_version: "4.0-candidate-identity-hardened",
  },
};
check("generic fixture frozen candidate", "frozen_candidate.schema.json", fixtureFrozenCandidate, { kind: "fixture" });

const fixtureApproval = {
  frozen_candidate_hash: "1".repeat(64),
  candidate_hash: "1".repeat(64),
  candidate_source_sha: "0".repeat(40),
  render_bundle_hash: "2".repeat(64),
  approved: false,
  approved_by: "",
  approved_at: "2026-01-01T00:00:00Z",
  notes: "Fixture only; no approval granted.",
  review_run_id: "10000000000",
  review_artifact_name: "orvyq-full-length-review-example",
  review_total_frames: 1800,
  review_duration_seconds: 60,
  review_resolution: "1280x720",
  review_video_sha256: "3".repeat(64),
};
check("generic fixture approval", "proof_approval.schema.json", fixtureApproval, { kind: "fixture" });

const fixtureAlignment = {
  schema_version: "1.0-canonical",
  project_id: FIXTURE_PROJECT_ID,
  source_audio_sha256: "0".repeat(64),
  model: "tiny.en",
  generated_at: "2026-01-01T00:00:00Z",
  duration_seconds: 52,
  script_similarity: 0.97,
  transcript: "The evidence begins with a simple question.",
  words: [{ text: "The", start: 0, end: 0.3, probability: 0.9 }],
};
check("generic fixture narration alignment", "narration_alignment.schema.json", fixtureAlignment, { kind: "fixture" });

const fixtureResolvedPausePlan = {
  schema_version: "1.0-resolved-pause-plan",
  project_id: FIXTURE_PROJECT_ID,
  source_pause_map: "direction/editorial_pause_map.json",
  source_alignment: "voice/narration_alignment.json",
  narration_end_seconds: 52,
  pauses: [{
    pause_id: "PAUSE_FULL_01_abcd1234",
    anchor_text: "The evidence begins here.",
    purpose: "Open the central question",
    sound_cue: "tonal_bloom",
    source_time_seconds: 20,
    duration_seconds: 4,
  }],
};
check("generic fixture resolved pause plan", "resolved_pause_plan.schema.json", fixtureResolvedPausePlan, { kind: "fixture" });

const registryPath = path.resolve("music_library", "registry.json");
if (fs.existsSync(registryPath)) {
  check("shared music registry", "music_registry.schema.json", readJson(registryPath), { kind: "real shared" });
}

let failed = 0;
for (const result of results) {
  const status = result.ok ? "PASS" : "FAIL";
  if (!result.ok) failed += 1;
  console.log(`[${status}] (${result.kind}) ${result.label} -- ${result.schemaFile}`);
  if (!result.ok) console.log(JSON.stringify(result.errors, null, 2));
}
console.log(`\n${results.length - failed}/${results.length} checks passed across ${readyProjects().length} ready project(s).`);
if (failed > 0) process.exitCode = 1;
