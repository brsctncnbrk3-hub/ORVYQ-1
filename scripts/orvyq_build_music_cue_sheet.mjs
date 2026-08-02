#!/usr/bin/env node
import path from "node:path";
import {
  projectDir,
  readJson,
  writeJsonAtomic,
  parseArgs,
  printJson,
} from "./lib/fs-utils.mjs";
import { loadMusicRegistry, findTrack } from "./lib/orvyq-music-registry.mjs";

const STATE_PROFILES = [
  {
    state: "controlled_tension",
    energy_start: 0.24,
    energy_end: 0.48,
    function: "Introduce the race paradox with a restrained pulse and leave room for the opening question.",
    instrumentation: "ambient guitar texture, low electronic pulse, minimal melodic foreground",
    transition_out: "thin the pulse before controlled evaluation evidence",
    track: "alt",
  },
  {
    state: "analytical_unease",
    energy_start: 0.28,
    energy_end: 0.52,
    function: "Keep controlled-test evidence procedural and unsettling without sensationalizing it.",
    instrumentation: "melody-reduced electronica, dry pulse, restrained industrial texture",
    transition_out: "increase rhythmic definition into competitive pressure",
    track: "alt",
  },
  {
    state: "accelerating_pressure",
    energy_start: 0.46,
    energy_end: 0.72,
    function: "Express investment, benchmark proximity and competitive acceleration through rhythm rather than loudness.",
    instrumentation: "driving synth backend, pulsing beat, widened electronic field",
    transition_out: "reduce the beat sharply before real-world misuse evidence",
    track: "full",
  },
  {
    state: "procedural_threat",
    energy_start: 0.42,
    energy_end: 0.66,
    function: "Support cyber and biological-risk evidence with factual tension and space for attribution caveats.",
    instrumentation: "dark electronica, controlled synth drive, no trailer impacts",
    transition_out: "release into a lower-energy uncertainty bed",
    track: "full",
  },
  {
    state: "uncertain_transition",
    energy_start: 0.26,
    energy_end: 0.44,
    function: "Shift from immediate misuse to slower questions of persuasion, work and concentrated infrastructure.",
    instrumentation: "melody-reduced ambient electronics, softened pulse, reduced low end",
    transition_out: "add institutional weight without increasing loudness",
    track: "alt",
  },
  {
    state: "institutional_gravity",
    energy_start: 0.34,
    energy_end: 0.5,
    function: "Give regulation and compliance material weight while preserving the film's central ambiguity about control.",
    instrumentation: "low electronic bed, sparse industrial texture, restrained harmonic movement",
    transition_out: "split into a balanced, low-motion trade-off state",
    track: "alt",
  },
  {
    state: "balanced_tension",
    energy_start: 0.38,
    energy_end: 0.5,
    function: "Hold open and closed model trade-offs in tension without musically declaring a winner.",
    instrumentation: "melody-reduced pulse, complementary ambient layers, narrow dynamic range",
    transition_out: "restore forward motion for the safeguards section",
    track: "alt",
  },
  {
    state: "constructive_momentum",
    energy_start: 0.4,
    energy_end: 0.64,
    function: "Give technical, procedural and structural safeguards credible forward movement.",
    instrumentation: "driving synth layer, measured pulse, controlled lift",
    transition_out: "remove rhythmic weight and leave a reflective electronic bed",
    track: "full",
  },
  {
    state: "reflective_resolution",
    energy_start: 0.4,
    energy_end: 0.08,
    function: "Return responsibility to human choices and end with thought rather than triumph or catastrophe.",
    instrumentation: "melody-reduced atmospheric electronics with a long natural decay",
    transition_out: "five-second clean release into black",
    track: "alt",
  },
];

function round(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function orderedSectionDurations(shots, declaredSections) {
  const order = [];
  const durations = new Map();
  const fallbackSection = declaredSections.at(-1)?.section_id || "SEC_09_FINAL_SYNTHESIS";
  for (const shot of shots) {
    const sectionId = shot.section_id || order.at(-1) || fallbackSection;
    if (!durations.has(sectionId)) {
      order.push(sectionId);
      durations.set(sectionId, 0);
    }
    const duration = Number(shot.duration || 0);
    if (!(duration > 0)) throw new Error(`Shot in ${sectionId} has invalid duration ${shot.duration}`);
    durations.set(sectionId, durations.get(sectionId) + duration);
  }
  for (const section of declaredSections) {
    if (!durations.has(section.section_id)) {
      throw new Error(`Generated production has no shots for ${section.section_id}`);
    }
  }
  return order.map((sectionId) => ({ section_id: sectionId, duration: durations.get(sectionId) }));
}

function cueId(index, sectionId) {
  const suffix = String(sectionId).replace(/^SEC_\d+_/, "");
  return `CUE_${String(index + 1).padStart(2, "0")}_${suffix}`;
}

export async function buildMusicCueSheet(projectId, targetDurationSeconds) {
  const root = projectDir(projectId);
  const [blueprint, evidenceMap, plan, registry] = await Promise.all([
    readJson(path.join(root, "direction", "editorial_blueprint.json")),
    readJson(path.join(root, "research", "evidence_map.json")),
    readJson(path.join(root, "config", "music_acquisition.json")),
    loadMusicRegistry(),
  ]);
  for (const [label, document] of Object.entries({ blueprint, evidenceMap, plan })) {
    if (document.project_id !== projectId) throw new Error(`${label} project_id mismatch`);
  }
  const shots = blueprint.full_production?.shots || [];
  if (blueprint.full_production?.status !== "ready" || !shots.length) {
    throw new Error("Full production shot list must be ready before music cues are generated");
  }
  const fullTrackId = plan.tracks.find((track) => track.track_id === "sb_resonance")?.track_id;
  const altTrackId = plan.tracks.find((track) => track.track_id === "sb_resonance_altmix")?.track_id;
  if (!fullTrackId || !altTrackId) throw new Error("Project music plan must declare both Resonance variants");
  for (const trackId of [fullTrackId, altTrackId]) {
    const track = findTrack(registry, trackId);
    if (!track || track.status !== "approved" || track.approved_for_full !== true) {
      throw new Error(`Music registry track ${trackId} is not approved for full production`);
    }
    if (track.composition_family !== "resonance") {
      throw new Error(`${trackId} has unexpected composition_family ${track.composition_family}`);
    }
  }

  const declaredSections = blueprint.full_production.sections?.length
    ? blueprint.full_production.sections
    : evidenceMap.sections;
  const sections = orderedSectionDurations(shots, declaredSections);
  if (sections.length !== STATE_PROFILES.length) {
    throw new Error(`Expected ${STATE_PROFILES.length} ordered sections, found ${sections.length}`);
  }
  const measuredTotal = sections.reduce((sum, section) => sum + section.duration, 0);
  const target = Number(targetDurationSeconds);
  if (!(target > 0)) throw new Error(`Invalid target duration ${targetDurationSeconds}`);
  const finalAdjustment = target - measuredTotal;
  if (Math.abs(finalAdjustment) > 20) {
    throw new Error(`Shot-derived music duration ${measuredTotal}s differs from candidate duration ${target}s by ${finalAdjustment}s`);
  }
  sections[sections.length - 1].duration += finalAdjustment;
  if (!(sections.at(-1).duration > 5)) throw new Error("Final music section became too short after duration reconciliation");

  let cursor = 0;
  const fullCues = sections.map((section, index) => {
    const profile = STATE_PROFILES[index];
    const start = round(cursor);
    cursor += section.duration;
    const end = index === sections.length - 1 ? round(target) : round(cursor);
    return {
      cue_id: cueId(index, section.section_id),
      section_id: section.section_id,
      start,
      end,
      state: profile.state,
      energy_start: profile.energy_start,
      energy_end: profile.energy_end,
      function: profile.function,
      instrumentation: profile.instrumentation,
      transition_out: profile.transition_out,
      status: "ready",
      track_id: profile.track === "full" ? fullTrackId : altTrackId,
    };
  });

  const cueSheet = {
    schema_version: "1.1-shot-derived",
    project_id: projectId,
    duration_seconds: round(target),
    generated_at: new Date().toISOString(),
    generation_basis: "Current Project 004 full-production shots and current candidate duration; no Project 001 cue timing was reused.",
    policy: {
      minimum_distinct_music_states: 4,
      single_tonal_world_required: true,
      composition_family: "resonance",
      narration_ducking_required: true,
      random_whoosh_glitch_boom_forbidden: true,
      silence_may_be_used_as_an_editorial_cue: true,
      full_render_requires_all_cues_ready: true,
    },
    proof_score: {
      status: "ready",
      track_id: altTrackId,
      duration_seconds: Math.min(150, round(target)),
      asset: "assets/music/approved_bed.mp3",
      license: plan.license_name,
      attribution_file: "assets/music/approved_bed.provenance.json",
      sections: [],
    },
    full_cues: fullCues,
  };
  await writeJsonAtomic(path.join(root, "direction", "music_cue_sheet.json"), cueSheet);
  return {
    project_id: projectId,
    duration_seconds: cueSheet.duration_seconds,
    cue_count: fullCues.length,
    track_ids: [...new Set(fullCues.map((cue) => cue.track_id))],
    composition_family: "resonance",
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const projectId = args["project-id"] || args.project;
  const targetDuration = Number(args["target-duration-seconds"]);
  if (!projectId) throw new Error("--project-id is required");
  buildMusicCueSheet(projectId, targetDuration)
    .then((result) => printJson({ ok: true, ...result }))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
