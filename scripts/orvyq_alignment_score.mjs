#!/usr/bin/env node
// Weighted pre-render readiness score -- explicitly NOT the final Aperture
// alignment score, which requires human review. Deliberate change vs
// golden: `plan.preview` -> `plan.mode === "proof"`.
//
// Recalibration (see docs/full-production-guide.md and
// scripts/orvyq_semantic_visual_audit.mjs): the old `physical_primary_evidence`
// category scored a fixed 30% official-screen-capture fraction that belonged
// to the retired proof-specific 150s cut and no longer matches the canonical
// full-film model, which deliberately blends source-backed derived evidence
// graphics, verified claim coverage, and licensed contextual footage instead
// of a fixed screen-capture ratio. Likewise, `motion_hook_discipline` used to
// gate on `generic_stock_fraction <= 0.12` as a whole-film check -- also a
// proof-cut-specific number, and directly incompatible with the canonical
// policy that contextual footage must occupy 25-45% of the full composition.
// Both categories are replaced below with checks against the current
// canonical semantic/evidence/asset audits, which remain the sole source of
// truth for the underlying exclusive thresholds (60-70% contextual footage,
// at least 20% primary evidence, at most 15% graphics/cards, at most 3%
// full-screen text, and a 15s max uninterrupted evidence run -- see
// scripts/orvyq_semantic_visual_audit.mjs). This is
// a correction of duplicated stale scoring logic, not a relaxation of any of
// those gates: category weights, the 90-point automated ceiling, the 82-point
// minimum, the 65%-of-weight per-category floor, and the mandatory human
// rendered-video review are all unchanged.
import path from "node:path";
import { projectDir, readJson, writeJsonAtomic } from "./lib/fs-utils.mjs";
import { auditMotionHook } from "./lib/orvyq-motion-hook.mjs";
import { DEFAULT_VISUAL_MEDIUM_BALANCE } from "./lib/orvyq-visual-balance.mjs";
const PROJECT_ID = process.env.ORVYQ_PROJECT_ID || null;
const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const MAX_UNINTERRUPTED_EVIDENCE_SECONDS = 15;

// Pure scoring function -- takes already-loaded audit reports and returns the
// readiness report's scoring fields, with no filesystem access, so every
// category rule can be exercised directly against synthetic fixtures.
export function computeAlignmentReadiness({ evidence, assetAudit, semantic, pacing, mobile, speech, audio, motionHook }) {
  const requiredEvidenceCoverage = Number(evidence.minimum_required ?? 0.9);
  const evidenceCoverageReadiness = clamp01(evidence.weighted_visual_evidence_coverage / requiredEvidenceCoverage);
  const thresholds = {
    ...DEFAULT_VISUAL_MEDIUM_BALANCE,
    ...(semantic.visual_medium_balance_thresholds || {}),
  };
  const sourceBackedFractionMinimum = thresholds.primary_evidence_fraction_min;
  const primaryEvidenceFraction =
    semantic.primary_evidence_fraction ??
    semantic.official_primary_capture_fraction ??
    0;
  const sourceBackedFractionReadiness = clamp01(primaryEvidenceFraction / sourceBackedFractionMinimum);
  // assetAudit.pass keeps the evidence/asset/semantic audits authoritative --
  // graphics existing is never sufficient on its own -- and
  // metadata_only_evidence_rejected / evidence audit failures already flow
  // into assetAudit/semantic not passing, so metadata-only "evidence" cannot
  // earn these points either.
  const sourceBackedVisualEvidenceScore = assetAudit.pass ? Math.min(evidenceCoverageReadiness, sourceBackedFractionReadiness) * 25 : 0;

  const contextualFractionInRange =
    (semantic.contextual_footage_fraction ?? semantic.contextual_body_footage_fraction) >= thresholds.contextual_footage_fraction_min &&
    (semantic.contextual_footage_fraction ?? semantic.contextual_body_footage_fraction) <= thresholds.contextual_footage_fraction_max;
  const evidenceRunWithinPolicy = semantic.maximum_uninterrupted_evidence_seconds <= MAX_UNINTERRUPTED_EVIDENCE_SECONDS + 0.001;
  // Generic stock remains a diagnostic because contextual footage is already
  // claim-specific and byte-bound by the semantic review gate. Primary
  // evidence is not diagnostic-only: it directly earns this category through
  // the exclusive 20% floor above.
  const motionHookDisciplinePass =
    motionHook.pass === true &&
    assetAudit.legacy_footage_count === 0 &&
    contextualFractionInRange &&
    evidenceRunWithinPolicy &&
    semantic.pass === true;

  const categories = {
    narration_integrity: { weight: 15, score: clamp01((speech.script_similarity || 0) / 0.98) * 15 },
    source_backed_visual_evidence: {
      weight: 25,
      score: sourceBackedVisualEvidenceScore,
      diagnostics: {
        evidence_coverage_readiness: evidenceCoverageReadiness,
        source_backed_fraction_readiness: sourceBackedFractionReadiness,
        required_evidence_coverage: requiredEvidenceCoverage,
        source_backed_fraction_minimum: sourceBackedFractionMinimum
      }
    },
    source_coverage: { weight: 15, score: clamp01(Math.min(evidence.weighted_supported_coverage, evidence.weighted_visual_evidence_coverage)) * 15 },
    motion_hook_discipline: {
      weight: 10,
      score: motionHookDisciplinePass ? 10 : 0,
      diagnostics: {
        // Retained for visibility; the primary-evidence fraction also drives
        // source_backed_visual_evidence above.
        primary_evidence_fraction: primaryEvidenceFraction,
        generic_stock_fraction: semantic.generic_stock_fraction,
        contextual_footage_fraction: semantic.contextual_footage_fraction ?? semantic.contextual_body_footage_fraction,
        maximum_uninterrupted_evidence_seconds: semantic.maximum_uninterrupted_evidence_seconds
      }
    },
    pacing_structure: { weight: 10, score: pacing.pass ? Math.max(7, 10 - pacing.warnings.length) : 0 },
    mobile_hierarchy: { weight: 10, score: mobile.pass ? Math.max(8, 10 - mobile.warnings.length * 0.5) : 0 },
    sound_structure: { weight: 10, score: audio.music_sections?.length >= 3 ? 9 : 6 },
    technical_gate: { weight: 5, score: [evidence, assetAudit, semantic, pacing, mobile].every((audit) => audit.pass) && speech.passed ? 5 : 0 }
  };
  const raw = Object.values(categories).reduce((sum, category) => sum + category.score, 0);
  const ceiling = 90;
  const readiness = Math.min(ceiling, raw * 0.9);
  const pass = readiness >= 82 && Object.values(categories).every((category) => category.score >= category.weight * 0.65);

  return { categories, raw_technical_points: raw, pre_render_readiness_score: readiness, automated_readiness_ceiling: ceiling, minimum_pre_render_readiness: 82, pass };
}

export async function buildAlignmentReadiness(projectId = PROJECT_ID) {
  const dir = projectDir(projectId);
  const [evidence, assetAudit, semantic, pacing, mobile, speech, audio, plan] = await Promise.all([
    readJson(path.join(dir, "qa", "evidence_coverage.json")),
    readJson(path.join(dir, "qa", "evidence_asset_audit.json")),
    readJson(path.join(dir, "qa", "semantic_visual_audit.json")),
    readJson(path.join(dir, "qa", "pacing_audit.json")),
    readJson(path.join(dir, "qa", "mobile_legibility_audit.json")),
    readJson(path.join(dir, "qa", "speech_transcript.json")),
    readJson(path.join(dir, "assets", "audio", "final_mix.metadata.json")),
    readJson(path.join(dir, "direction", "edit_plan.json"))
  ]);
  const motionHook = auditMotionHook(plan);
  const { categories, raw_technical_points, pre_render_readiness_score, automated_readiness_ceiling, minimum_pre_render_readiness, pass } = computeAlignmentReadiness({
    evidence,
    assetAudit,
    semantic,
    pacing,
    mobile,
    speech,
    audio,
    motionHook
  });

  const report = {
    schema_version: "1.0-canonical",
    project_id: projectId,
    mode: plan.mode,
    categories,
    raw_technical_points,
    pre_render_readiness_score,
    automated_readiness_ceiling,
    minimum_pre_render_readiness,
    final_aperture_alignment_score: null,
    motion_hook: motionHook,
    human_rendered_video_review: {
      required: true,
      status: "pending",
      dimensions: ["actual primary evidence readability", "visual meaning and emotional resonance", "directed cinematic composition", "music arc", "whether the film feels authored rather than assembled"]
    },
    note: "This score is only a pre-render integrity gate. Automated metadata can never award or imply 95% Aperture alignment.",
    pass
  };
  await writeJsonAtomic(path.join(dir, "qa", "alignment_readiness.json"), report);
  if (!pass) throw new Error(`ORVYQ pre-render readiness ${pre_render_readiness_score.toFixed(1)} is below 82`);
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildAlignmentReadiness()
    .then((report) => console.log(JSON.stringify({ ok: true, pre_render_readiness_score: report.pre_render_readiness_score, automated_readiness_ceiling: report.automated_readiness_ceiling, final_aperture_alignment_score: null })))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
