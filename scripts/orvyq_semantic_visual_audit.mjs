#!/usr/bin/env node
// Visual-rhythm/fraction gate -- keeps the film footage-led rather than a
// document slideshow. Deliberate change vs golden: `plan.preview` ->
// `plan.mode`, matching the canonical edit_plan.schema.json shape.
import path from "node:path";
import { projectDir, readJson, writeJsonAtomic } from "./lib/fs-utils.mjs";
import { loadResolvedEvidenceMap } from "./lib/orvyq-evidence.mjs";
import { auditMotionHook } from "./lib/orvyq-motion-hook.mjs";
import { loadProductionPolicy } from "./lib/orvyq-project-profile.mjs";
import {
  auditSectionVisualBalance,
  auditGraphicCardDesign,
  auditVisualMediumBalance,
  classifyVisualMedium,
} from "./lib/orvyq-visual-balance.mjs";
const PROJECT_ID = process.env.ORVYQ_PROJECT_ID || null;
const VALID_ROLES = new Set(["evidence", "archive", "context", "human_context", "metaphor", "graphic"]);
const OFFICIAL = new Set(["split_documents", "official_document", "official_figure", "official_screen", "image_sequence", "recap"]);
const DERIVED = new Set(["source_timeline", "source_article", "concept_map", "boundary", "comparison", "evidence_chain"]);
const CRITICAL = 5;
const SEMANTIC_LINKS = new Set([
  "physical",
  "historical",
  "conceptual",
  "direct_evidence",
]);

function canonicalText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

export function presentationMotifKey(shot) {
  if (shot.asset_type === "evidence") {
    const evidence = shot.evidence || {};
    const imageIdentity = [...(evidence.image_assets || [])].sort().join("|");
    const contentIdentity = [
      canonicalText(evidence.left),
      canonicalText(evidence.left_detail),
      canonicalText(evidence.right),
      canonicalText(evidence.right_detail),
      canonicalText(evidence.body),
      canonicalText(evidence.limitation),
    ].join("|");
    return [
      "evidence",
      evidence.kind || "",
      canonicalText(evidence.title),
      imageIdentity ? `images:${imageIdentity}` : `content:${contentIdentity}`,
    ].join(":");
  }
  if (shot.asset_type === "graphic") {
    const graphic = shot.graphic || {};
    return [
      "graphic",
      graphic.type || "",
      canonicalText(graphic.title),
      canonicalText(graphic.subtitle),
      ...(graphic.labels || []).map(canonicalText),
    ].join(":");
  }
  return null;
}

export async function runSemanticVisualAudit(projectId = PROJECT_ID) {
  const dir = projectDir(projectId);
  const [plan, blueprint, evidenceMap, policy] = await Promise.all([
    readJson(path.join(dir, "direction", "edit_plan.json")),
    readJson(path.join(dir, "direction", "editorial_blueprint.json")),
    loadResolvedEvidenceMap(dir),
    loadProductionPolicy(projectId),
  ]);
  const rules = {
    ...blueprint.global_rules,
    ...(policy.project.visual_medium_balance || {}),
  };
  const failures = [];
  const warnings = [];
  let footageFrames = 0, genericStockFrames = 0, contextualBodyFrames = 0, officialFrames = 0, derivedFrames = 0, pureGraphicFrames = 0, emphasisBeats = 0, currentEvidenceRunFrames = 0, maximumEvidenceRunFrames = 0;
  const roleFrames = {};
  const repeatedPresentationMotifs = new Map();
  const imageUses = new Map();

  for (const shot of plan.shots) {
    const frames = shot.end_frame - shot.start_frame;
    if (!VALID_ROLES.has(shot.visual_role)) failures.push(`${shot.shot_id} invalid visual_role`);
    if (!shot.editorial_purpose || shot.editorial_purpose.length < 18) failures.push(`${shot.shot_id} lacks editorial purpose`);
    if (!shot.claim_id) failures.push(`${shot.shot_id} lacks claim_id`);
    if (!canonicalText(shot.narration_anchor)) failures.push(`${shot.shot_id} lacks narration_anchor`);
    if (canonicalText(shot.semantic_rationale).length < 24) failures.push(`${shot.shot_id} lacks a specific semantic_rationale`);
    if (!SEMANTIC_LINKS.has(shot.semantic_link)) failures.push(`${shot.shot_id} has invalid semantic_link ${shot.semantic_link || "(missing)"}`);
    roleFrames[shot.visual_role] = (roleFrames[shot.visual_role] || 0) + frames;
    // Counted once per shot regardless of asset_type: an emphasis beat is a
    // pause-driven text overlay, and now that contextual footage can host
    // one too (the shot continues playing under the pause rather than
    // cutting to a graphic card), scoping this to footage-only shots would
    // undercount full mode, whose pauses land on a mix of evidence, graphic,
    // and footage shots.
    if (shot.emphasis_card) emphasisBeats += 1;
    if (shot.editorial_overlay?.type === "email_recreation") {
      failures.push(`${shot.shot_id} uses a decorative document recreation; real evidence or a non-document explanation is required`);
    }
    if (shot.asset_type === "footage") {
      footageFrames += frames;
      if (shot.generic_stock === true) genericStockFrames += frames;
      if (shot.contextual_footage === true) {
        contextualBodyFrames += frames;
      }
      // Applies to both modes now: hook footage is always allowed, and any
      // other footage shot (proof or full) must be approved contextual
      // footage under the shared cinematic_body_footage policy -- there is
      // no full-mode exemption from this check anymore.
      if (
        shot.hook_footage !== true &&
        !(plan.quality_policy?.cinematic_body_footage === true && shot.contextual_footage === true && shot.provenance_mode === "approved_contextual_footage")
      )
        failures.push(`${shot.shot_id} uses unapproved body footage`);
      currentEvidenceRunFrames = 0;
    } else if (shot.asset_type === "evidence") {
      currentEvidenceRunFrames += frames;
      maximumEvidenceRunFrames = Math.max(maximumEvidenceRunFrames, currentEvidenceRunFrames);
      const kind = shot.evidence?.kind;
      if (OFFICIAL.has(kind)) {
        officialFrames += frames;
      } else if (DERIVED.has(kind)) {
        derivedFrames += frames;
      }
      else failures.push(`${shot.shot_id} unknown evidence kind ${kind}`);
      if (!(shot.evidence?.source_ids || []).length) failures.push(`${shot.shot_id} evidence has no source IDs`);
      for (const image of shot.evidence?.image_assets || []) imageUses.set(image, (imageUses.get(image) || 0) + 1);
    } else if (shot.asset_type === "graphic") {
      pureGraphicFrames += frames;
      currentEvidenceRunFrames = 0;
    }
    if (classifyVisualMedium(shot) === "invalid") failures.push(`${shot.shot_id} cannot be assigned to one exclusive visual-medium category`);
    // A source title is not a visual identity. The same JAMSTEC page can
    // legitimately introduce different captured figures, and one IEA
    // source can support several distinct boundary comparisons. Count a
    // repeat only when the reader-facing image/content is the same, not
    // merely when its citation title matches.
    const motif = presentationMotifKey(shot);
    if (motif) repeatedPresentationMotifs.set(motif, (repeatedPresentationMotifs.get(motif) || 0) + 1);
  }

  const duration = plan.duration_frames || 1;
  const genericFraction = genericStockFrames / duration;
  const totalFootageFraction = footageFrames / duration;
  const visualMediumBalance = auditVisualMediumBalance({
    shots: plan.shots,
    durationFrames: duration,
  }, rules);
  const sectionVisualBalance = auditSectionVisualBalance(plan.shots, rules);
  const graphicCardDesign = auditGraphicCardDesign(plan.shots);
  const motionHook = auditMotionHook(plan);
  // cinematic_body_footage is unconditionally true for both modes (see
  // scripts/orvyq_edit_plan.mjs) -- proof is now a genuine frame-prefix of
  // the full candidate, sourced from the exact same full_production shots
  // and duration_frames rather than a separately-authored short cut, so
  // there is no longer a "proof" data model distinct from "full" for any of
  // these fraction checks to apply differently to. Every threshold below
  // applies identically to both modes' plan.shots/duration_frames, which are
  // themselves identical regardless of which mode label produced this run.
  const cinematicCandidate = plan.quality_policy?.cinematic_body_footage === true;
  if (!motionHook.pass) failures.push(...motionHook.failures);
  if (cinematicCandidate) {
    failures.push(...visualMediumBalance.failures);
    failures.push(...sectionVisualBalance.failures);
    failures.push(...graphicCardDesign.failures);
  }
  if (cinematicCandidate && emphasisBeats < 4) failures.push(`cinematic candidate contains ${emphasisBeats} emphasis beats; 4 required`);
  if (cinematicCandidate && maximumEvidenceRunFrames / plan.fps > Number(plan.quality_policy?.maximum_uninterrupted_evidence_seconds || 15) + 0.001)
    failures.push(`uninterrupted evidence run ${(maximumEvidenceRunFrames / plan.fps).toFixed(2)}s exceeds 15s`);

  for (const claim of evidenceMap.claims.filter((item) => item.importance >= CRITICAL && item.status !== "removed")) {
    const shots = plan.shots.filter((shot) => shot.claim_id === claim.claim_id);
    if (!shots.length) continue;
    if (!shots.some((shot) => shot.asset_type === "evidence" && (shot.evidence?.source_ids || []).length))
      failures.push(`${claim.claim_id} has no physical source-backed evidence scene`);
  }
  const overusedImages = [...imageUses.entries()].filter(([, count]) => count > Number(rules.max_uses_per_source || 2));
  if (overusedImages.length) failures.push(`primary images exceed use limit: ${overusedImages.map(([name, count]) => `${name}=${count}`).join(", ")}`);
  const repeatedMotifs = [...repeatedPresentationMotifs.entries()].filter(([, count]) => count > 2);
  if (repeatedMotifs.length) failures.push(`presentation motifs repeat more than twice: ${repeatedMotifs.map(([name, count]) => `${name}=${count}`).join(", ")}`);
  for (let index = 1; index < plan.shots.length; index++) {
    const previous = new Set(plan.shots[index - 1].evidence?.image_assets || []);
    const current = new Set(plan.shots[index].evidence?.image_assets || []);
    if (current.size && [...current].every((image) => previous.has(image))) failures.push(`${plan.shots[index].shot_id} immediately repeats identical primary evidence`);
  }

  const report = {
    schema_version: "1.0-canonical",
    project_id: projectId,
    mode: plan.mode,
    role_fractions: Object.fromEntries(Object.entries(roleFrames).map(([role, frames]) => [role, frames / duration])),
    generic_stock_fraction: genericFraction,
    total_footage_fraction: totalFootageFraction,
    contextual_footage_fraction: visualMediumBalance.contextual_footage_fraction,
    primary_evidence_fraction: visualMediumBalance.primary_evidence_fraction,
    graphic_card_fraction: visualMediumBalance.graphic_card_fraction,
    full_screen_text_card_fraction: visualMediumBalance.full_screen_text_card_fraction,
    exclusive_visual_medium_frame_total: visualMediumBalance.exclusive_frame_total,
    invalid_visual_medium_frames: visualMediumBalance.invalid_frames,
    maximum_consecutive_graphic_card_shots: visualMediumBalance.maximum_consecutive_graphic_card_shots,
    graphic_template_uses: visualMediumBalance.graphic_template_uses,
    // Transitional aliases for downstream reports. They now mirror the
    // exclusive categories and cannot be added together as overlapping
    // metadata-defined buckets.
    contextual_body_footage_fraction: visualMediumBalance.contextual_footage_fraction,
    official_primary_capture_fraction: visualMediumBalance.primary_evidence_fraction,
    source_derived_graphic_fraction: derivedFrames / duration,
    evidence_archive_fraction: visualMediumBalance.primary_evidence_fraction,
    full_screen_graphic_fraction: visualMediumBalance.full_screen_text_card_fraction,
    card_like_visual_fraction: visualMediumBalance.graphic_card_fraction,
    visual_medium_balance_thresholds: visualMediumBalance.thresholds,
    section_visual_balance: sectionVisualBalance.sections,
    graphic_card_design: graphicCardDesign,
    emphasis_beat_count: emphasisBeats,
    maximum_uninterrupted_evidence_seconds: maximumEvidenceRunFrames / plan.fps,
    image_uses: Object.fromEntries([...imageUses.entries()].sort((a, b) => b[1] - a[1])),
    metadata_cannot_override_asset_class: true,
    motion_hook: motionHook,
    warnings,
    failures,
    pass: failures.length === 0
  };
  await writeJsonAtomic(path.join(dir, "qa", "semantic_visual_audit.json"), report);
  if (!report.pass) throw new Error(`ORVYQ semantic visual audit failed: ${failures.join("; ")}`);
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSemanticVisualAudit()
    .then((report) => console.log(JSON.stringify({ ok: true, ...report })))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
