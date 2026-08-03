#!/usr/bin/env node
// buildFullProductionPlan() -- generates direction/editorial_blueprint.json's
// full_production.shots array from real data only: the resolved evidence
// claims (research/evidence_map.json + evidence_resolutions.json, via
// loadResolvedEvidenceMap), each claim's real spoken position located in
// voice/narration_alignment.json (the same real ASR word timestamps
// scripts/lib/orvyq-pause-resolver.mjs uses for pause anchors), and the
// resolved full-film pause windows themselves.
//
// Every second of the narration timeline is assigned to exactly one claim
// (no gaps): claim i's coverage runs from the end of claim i-1's own quoted
// excerpt to the start of claim i+1's quoted excerpt, so connective
// narration between two quoted claims stays visually attached to the
// claim that just finished speaking rather than being left unplanned.
//
// Contextual footage IS referenced here: FOOTAGE_ASSIGNMENTS assigns real,
// licensed clips (validated via scripts/orvyq_materialize_footage.mjs
// from projects/*/assets/local_assets.json, the repository-owned source)
// to specific (claim_id,
// sliceIndex) pairs -- any slice of any claim's own coverage window is
// directly addressable, not restricted to a fixed positional pattern (see
// sliceClaimWindow/FOOTAGE_ASSIGNMENTS below). There is no automatic
// backfill: a long uninterrupted evidence/graphic run or an editorial pause
// that doesn't land on footage fails the build with a specific report
// (below) rather than being silently patched from FULL_FOOTAGE_POOL, which
// is documentation of the licensed catalog only. Every other claim beat is
// rendered as asset_type "evidence" using a NATIVE_KINDS kind (concept_map,
// comparison, evidence_chain, boundary, source_timeline, source_article) --
// derived from that claim's own visual_treatment.{primary,secondary,metaphor}
// fields, which are real editorial content already present in the resolved
// evidence map, not invented here. Each section opens with a short graphic
// title card. This produces a schema-valid, gap-free, zero-placeholder full
// shot list with real contextual footage across the whole film, not just an
// opening hook.
import path from "node:path";
import { projectDir, readJson, readJsonSafe, writeJsonAtomic, parseArgs, printJson } from "./lib/fs-utils.mjs";
import { loadProductionPolicy, resolveProjectId } from "./lib/orvyq-project-profile.mjs";
import { loadResolvedEvidenceMap } from "./lib/orvyq-evidence.mjs";
import { tokenizeWords, tokenizeAnchorText, findAnchorMatch, endsAtSentenceBoundary, endsAtClauseBoundary } from "./lib/orvyq-pause-resolver.mjs";
import { buildEvidenceContent } from "./lib/orvyq-evidence-authoring.mjs";
import { FPS, END_CARD_SECONDS } from "./lib/orvyq-timeline.mjs";
import { materializeVisualRebalancePlan } from "./lib/orvyq-visual-rebalance.mjs";

const TARGET_SHOT_SECONDS = 6;
const TITLE_CARD_SECONDS = 2.5;
// The first section title is a compact cinematic sting between opening
// evidence beats. Keeping it title-only at two seconds preserves the evidence
// break while leaving a deterministic margin below the 8% full-screen-card cap.
const FIRST_SECTION_TITLE_SECONDS = 2;
const DEFAULT_FONT_PX = 32;
export { END_CARD_SECONDS };

// Contextual footage placement -- see docs/full-production-guide.md and the
// commit that introduced this table for the editorial rationale. Every
// entry replaces ONE SPECIFIC, hand-chosen slice of a real claim's own
// coverage window with one of the licensed contextual footage clips
// validated by scripts/orvyq_materialize_footage.mjs, trimmed to that
// slice's exact real duration.
//
// Keyed by (claim_id, sliceIndex) -- sliceIndex is the claim's own slice's
// raw 0-based position in the array sliceClaimWindow() returns for that
// claim, exactly as buildFullProductionPlan enumerates it. This used to be
// gated by a fixed "every third slice" positional rule
// (`footageCandidateSlot: i % 3 === 2`) -- footage could only ever land on
// slice 2, 5, 8, ...  regardless of which slice actually needed it. That
// mechanism has been removed: any slice of any claim is now directly
// addressable here, so a coverage gap (an uninterrupted-evidence run over
// the cap, or a pause that doesn't land on footage) is closed by adding a
// real assignment at the slice that actually needs one, not by hoping a
// human-authored occurrence happens to fall on a multiple-of-three slot.
// The table's pre-existing entries were remapped from their old
// occurrence-among-candidates numbering to their real, unchanged slice
// index (old occurrence k landed on slice 3k+2 under the removed rule) --
// every one of them still lands on the exact same real footage, at the
// exact same real narration moment, as before.
//
// `trimInRatio` picks where in the source clip's real duration this use
// starts; a clip used twice uses two different windows of it, never the
// same footage twice in the same moment. Every asset referenced here was
// inspected frame-by-frame (see the commit message) before assignment, not
// chosen by filename order. Every entry carries an explicit `role` (never
// auto-rotated) and, for any asset that appears more than once across this
// table (and/or HOOK_PRELOADED_USAGE below), an explicit `reuse_reason` on
// every occurrence sharing that asset -- a second use of the same stock
// file is only allowed as a deliberate, named callback, never an
// unexplained repeat (verified by scripts/orvyq_duplicate_footage_audit.mjs).
export let FOOTAGE_ASSIGNMENTS = {};
export let GRAPHIC_BREAK_ASSIGNMENTS = {};
export let FULL_FOOTAGE_POOL = [];
export let HOOK_PRELOADED_USAGE = {};
export let SLICE_COUNT_OVERRIDES = {};
export let END_CARD_CONTENT = {};
let ACTIVE_EDITORIAL_ASSET_PROJECT = null;

export async function loadEditorialAssetPlan(projectId) {
  if (ACTIVE_EDITORIAL_ASSET_PROJECT === projectId) {
    return {
      footage_assignments: FOOTAGE_ASSIGNMENTS,
      graphic_break_assignments: GRAPHIC_BREAK_ASSIGNMENTS,
      full_footage_pool: FULL_FOOTAGE_POOL,
      hook_preloaded_usage: HOOK_PRELOADED_USAGE,
      slice_count_overrides: SLICE_COUNT_OVERRIDES,
    };
  }
  const dir = projectDir(projectId);
  const [assetPlan, policy] = await Promise.all([
    readJson(path.join(dir, "config", "editorial_asset_plan.json")),
    loadProductionPolicy(projectId),
  ]);
  if (assetPlan.project_id !== projectId) {
    throw new Error(`editorial_asset_plan project_id ${assetPlan.project_id} does not match ${projectId}`);
  }
  if (assetPlan.status !== "ready") {
    throw new Error(`editorial_asset_plan is not ready (status=${assetPlan.status || "missing"})`);
  }
  FOOTAGE_ASSIGNMENTS = assetPlan.footage_assignments || {};
  GRAPHIC_BREAK_ASSIGNMENTS = assetPlan.graphic_break_assignments || {};
  FULL_FOOTAGE_POOL = assetPlan.full_footage_pool || [];
  HOOK_PRELOADED_USAGE = assetPlan.hook_preloaded_usage || {};
  SLICE_COUNT_OVERRIDES = assetPlan.slice_count_overrides || {};
  END_CARD_CONTENT = policy.project.end_card || {};
  if (!END_CARD_CONTENT.title) throw new Error("production_profile.end_card.title is required");
  ACTIVE_EDITORIAL_ASSET_PROJECT = projectId;
  return assetPlan;
}


// Expands one claim's FOOTAGE_ASSIGNMENTS entries into a concrete
// sliceIndex -> {asset, trimInSec, trimOutSec, motion, role, reuseReason}
// map. Most entries cover exactly one slice (the default, `span: 1`,
// matching every entry's historical behavior exactly: trimInRatio picks
// where in the source clip this slice's content starts, clamped so its
// trim never overruns the clip's own real duration). An entry may instead
// declare `span: N > 1` to cover N contiguous slices with ONE real,
// continuously-trimmed pass through the same source clip -- the second and
// later slices continue exactly where the previous one's trim left off, so
// scripts/orvyq_duplicate_footage_audit.mjs's own contiguity rule (same
// asset, `trim_out_sec === trim_in_sec` within tolerance) recognizes the
// whole span as ONE use, not N separate ones. This is how a single
// licensed clip can break up a long claim's evidence run across several
// consecutive slices without spending several of that asset's limited
// max_uses_per_source budget -- the clip must actually be long enough to
// supply that much continuous real footage; expandFootageAssignments
// throws loudly, rather than silently clamping, if it is not.
export function expandFootageAssignments(claimId, sliceDurations, assetDurationSeconds, assignmentsTable = FOOTAGE_ASSIGNMENTS) {
  const declared = assignmentsTable[claimId];
  const expanded = new Map();
  if (!declared) return expanded;
  for (const [startIndexRaw, assignment] of Object.entries(declared)) {
    const startIndex = Number(startIndexRaw);
    const span = Math.max(1, Math.round(Number(assignment.span) || 1));
    const assetDuration = assetDurationSeconds.get(assignment.asset);
    if (!Number.isFinite(assetDuration)) throw new Error(`${claimId}: no known real duration for footage asset ${assignment.asset}`);

    if (span === 1) {
      const sliceIndex = startIndex;
      const sliceDuration = sliceDurations[sliceIndex];
      if (sliceDuration === undefined) throw new Error(`${claimId}: footage assignment at slice ${sliceIndex} does not exist (claim has ${sliceDurations.length} slices)`);
      if (expanded.has(sliceIndex)) throw new Error(`${claimId}: slice ${sliceIndex} has more than one footage assignment covering it`);
      const latestTrimIn = Math.max(0, assetDuration - sliceDuration - 0.3);
      const trimIn = Math.round(Math.min(assignment.trimInRatio * assetDuration, latestTrimIn) * 1000) / 1000;
      expanded.set(sliceIndex, {
        asset: assignment.asset,
        trimInSec: trimIn,
        trimOutSec: Math.round((trimIn + sliceDuration) * 1000) / 1000,
        motion: assignment.motion,
        role: assignment.role,
        reuseReason: assignment.reuse_reason || null,
        semanticRationale: assignment.semantic_rationale || assignment.reuse_reason || null,
        semanticLink: assignment.semantic_link || (assignment.role === "human_context" ? "physical" : "conceptual")
      });
      continue;
    }

    let trimCursor = Math.round(assignment.trimInRatio * assetDuration * 1000) / 1000;
    for (let offset = 0; offset < span; offset += 1) {
      const sliceIndex = startIndex + offset;
      const sliceDuration = sliceDurations[sliceIndex];
      if (sliceDuration === undefined) throw new Error(`${claimId}: footage span starting at slice ${startIndex} (span ${span}) reaches slice ${sliceIndex}, which does not exist (claim has ${sliceDurations.length} slices)`);
      if (expanded.has(sliceIndex)) throw new Error(`${claimId}: slice ${sliceIndex} has more than one footage assignment covering it`);
      const trimIn = trimCursor;
      const trimOut = Math.round((trimIn + sliceDuration) * 1000) / 1000;
      if (trimOut > assetDuration + 0.001)
        throw new Error(
          `${claimId}: footage span starting at slice ${startIndex} (asset ${assignment.asset}, real duration ${assetDuration}s) overruns that real duration at slice ${sliceIndex} (would need ${trimOut}s) -- ` +
            "shorten the span or pick a longer source clip"
        );
      expanded.set(sliceIndex, {
        asset: assignment.asset,
        trimInSec: trimIn,
        trimOutSec: trimOut,
        motion: assignment.motion,
        role: assignment.role,
        reuseReason: assignment.reuse_reason || null,
        semanticRationale: assignment.semantic_rationale || assignment.reuse_reason || null,
        semanticLink: assignment.semantic_link || (assignment.role === "human_context" ? "physical" : "conceptual")
      });
      trimCursor = trimOut;
    }
  }
  return expanded;
}

// Maps the editorial visual_treatment vocabulary already present in the
// resolved evidence claims onto the renderer's NATIVE_KINDS enum
// (schemas/shot.schema.json / scripts/orvyq_edit_plan.mjs). Built by hand
// from the real, exhaustive set of values in research/evidence_map.json +
// evidence_resolutions.json -- not a fuzzy keyword guess.
const KIND_BY_TREATMENT = {
  evidence_mosaic: "concept_map",
  comparison_overlay: "comparison",
  process_timeline: "source_timeline",
  document_evidence: "source_article",
  evidence_recreation: "evidence_chain",
  dual_evidence_chart: "comparison",
  threat_report_evidence: "source_article",
  campaign_phase_diagram: "evidence_chain",
  safety_level_diagram: "concept_map",
  exposure_vs_outcome: "comparison",
  evidence_comparison: "comparison",
  critical_inputs_map: "concept_map",
  two_track_policy_matrix: "comparison",
  cost_stack_diagram: "concept_map",
  balanced_tradeoff_matrix: "comparison",
  evaluation_pipeline: "evidence_chain",
  safeguard_stack: "concept_map",
  evidence_recap_montage: "source_timeline",
  evidence_chain: "evidence_chain",
  frontier_infrastructure: "concept_map",
  institutional_context: "concept_map",
  governance_context: "source_article",
  experiment_diagram: "evidence_chain",
  decision_tree: "evidence_chain",
  document_closeup: "source_article",
  dated_release_context: "source_timeline",
  attack_chain_diagram: "evidence_chain",
  reported_metric: "comparison",
  policy_document: "source_article",
  occupation_task_matrix: "comparison",
  cloud_market_evidence: "source_article",
  systemic_risk_threshold: "boundary",
  policy_context: "source_article",
  report_evidence: "source_article",
  government_methodology: "source_article",
  incident_flow: "evidence_chain",
  human_decision_context: "concept_map",
  report_frame: "source_article"
};

export function kindFor(treatmentValue) {
  return KIND_BY_TREATMENT[treatmentValue] || "boundary";
}

export function titleCase(sectionId) {
  return sectionId
    .replace(/^SEC_\d+_/, "")
    .split("_")
    .map((word) => word[0] + word.slice(1).toLowerCase())
    .join(" ");
}

export function narrationForRange(tokens, start, end, fallback) {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return String(fallback || "").trim();
  const words = tokens.filter((token) => token.end > start - 0.04 && token.start < end + 0.04).map((token) => token.raw);
  const anchor = words.join(" ").replace(/\s+([,.;:!?])/g, "$1").trim();
  return anchor || String(fallback || "").trim();
}

/** `assets/footage/scene_007_<provider-id>.mp4` -> `scene_007`. */
function sceneIdFromAsset(assetPath) {
  const match = String(assetPath || "").match(/(?:^|\/)scene_(\d{3})(?:_|\.)/);
  if (!match) throw new Error(`Cannot derive a scene id from footage asset ${assetPath || "<missing>"}`);
  return `scene_${match[1]}`;
}

function semanticLinkForEvidenceKind(kind) {
  return new Set(["official_document", "official_figure", "official_screen", "split_documents", "image_sequence", "recap"]).has(kind)
    ? "direct_evidence"
    : "conceptual";
}

function rationaleForEvidence(claimId, kind) {
  return semanticLinkForEvidenceKind(kind) === "direct_evidence"
    ? `Shows the verified primary-source region that directly supports ${claimId} at this narration beat.`
    : `Explains the relationship asserted by ${claimId}; this source-derived visual is used only where footage cannot show the mechanism precisely.`;
}

const MIN_CLAIM_MATCH_RATIO = 0.4;
// Common short words are unreliable anchors for greedy in-order matching:
// "a" or "to" recurs constantly, so matching one can jump the search
// cursor to a coincidental, unrelated occurrence and strand every
// following (genuinely distinctive) claim word. These are skipped when
// locating a claim's position -- they still appear in the excerpt text
// itself, just not used to anchor its position.
const STOPWORDS = new Set([
  "a", "an", "the", "to", "of", "in", "on", "at", "and", "or", "but", "is", "it", "its",
  "this", "that", "these", "those", "they", "them", "he", "she", "we", "you", "i", "as",
  "by", "be", "been", "being", "was", "were", "are", "for", "with", "from", "not", "no",
  "so", "if", "then", "than", "into", "over", "under", "up", "down", "out", "about", "can",
  "will", "would", "could", "should", "has", "have", "had", "do", "does", "did", "may", "might"
]);

// Not every claim's narration_excerpt is a verbatim quote -- some (mostly
// the ones evidence_resolutions.json never touched) are a paraphrase of the
// real script line, sometimes with words inserted/dropped/reordered, and
// real ASR output adds its own noise on top (homophone slips like "steal"
// heard as "steel", hyphenated compounds like "high-risk" transcribed as
// two separate words, dropped suffixes like "Established" heard as
// "Establish"). An exact-substring match is tried first since it is the
// common case and gives the tightest possible span; if that fails, this
// falls back to the bag-of-words window scorer below. At least
// MIN_CLAIM_MATCH_RATIO of the claim's own significant words must be found
// in the best window, or the claim is reported as unlocatable rather than
// guessed at.
export function locateClaimWindow(tokens, claim, searchFromTokenIndex) {
  const claimTokens = tokenizeAnchorText(claim.narration_excerpt);
  if (!claimTokens.length) throw new Error(`${claim.claim_id} has an empty narration_excerpt`);

  const exactMatchIndex = findAnchorMatch(tokens, claimTokens, searchFromTokenIndex);
  if (exactMatchIndex !== -1) {
    return {
      matchStart: tokens[exactMatchIndex].start,
      matchEnd: tokens[exactMatchIndex + claimTokens.length - 1].end,
      nextSearchTokenIndex: exactMatchIndex + claimTokens.length
    };
  }

  // A strict in-order match is fragile against real ASR/paraphrase text in
  // two different ways: a common word (e.g. "capital") can coincidentally
  // match an earlier, unrelated occurrence and strand every later claim
  // word behind it; and some editorial rewrites reorder clauses entirely
  // (e.g. CLM_016 says "Compliance costs may be easier for established
  // companies to absorb" where the real line says "Established companies
  // may... be able to absorb the complex compliance... costs" -- the same
  // words, in a different order). So this scores every candidate window by
  // bag-of-words containment (order-independent, each significant claim
  // word counted at most once) and keeps the best-scoring, earliest,
  // narrowest span -- still real word-for-word evidence, just not
  // requiring the claim's exact clause order to match the spoken order.
  const significantClaimTokens = [...new Set(claimTokens.filter((token) => !STOPWORDS.has(token)))];
  const tokensToMatch = significantClaimTokens.length ? significantClaimTokens : [...new Set(claimTokens)];
  const denominator = tokensToMatch.length;
  const windowLen = Math.max(40, tokensToMatch.length * 4);
  // Bounds how far past the search cursor a fallback match may be found --
  // generous enough for the largest real gap observed between two claims
  // (a whole removed claim's connecting narration, ~140 tokens) without
  // letting the scorer wander into some unrelated later claim's territory.
  const scanLimit = Math.min(tokens.length, searchFromTokenIndex + 400);

  let best = { count: 0, score: -Infinity, firstIndex: -1, lastIndex: -1 };
  for (let start = searchFromTokenIndex; start < scanLimit; start += 1) {
    const end = Math.min(tokens.length, start + windowLen);
    const found = new Set();
    let firstIndex = -1;
    let lastIndex = -1;
    for (let i = start; i < end; i += 1) {
      if (tokensToMatch.includes(tokens[i].norm) && !found.has(tokens[i].norm)) {
        found.add(tokens[i].norm);
        if (firstIndex === -1) firstIndex = i;
        lastIndex = i;
      }
    }
    if (firstIndex === -1) continue;
    const span = lastIndex - firstIndex;
    // Score, don't just count: a raw word-count max lets a stray word that
    // coincidentally belongs to a LATER claim (found only because the
    // window reached that far) beat a tighter, more localized match with
    // one fewer word -- observed for real, where CLM_018's own excerpt
    // ("before systems ship" -- the real line says "before THEY ship")
    // could only complete its full count by reaching into CLM_019's "when
    // SYSTEMS misbehave", overshooting the cursor past CLM_019's real
    // position entirely. Subtracting the normalized span prefers a
    // slightly-lower-count but tightly-clustered real phrase instead.
    const score = found.size - (span / tokensToMatch.length) * 0.4;
    if (score > best.score) {
      best = { count: found.size, score, firstIndex, lastIndex };
      if (found.size === tokensToMatch.length && span === tokensToMatch.length - 1) break;
    }
  }

  const matchRatio = best.count / denominator;
  if (best.firstIndex === -1 || matchRatio < MIN_CLAIM_MATCH_RATIO) {
    throw new Error(
      `${claim.claim_id}'s narration_excerpt ("${claim.narration_excerpt}") could not be located in voice/narration_alignment.json ` +
        `(best in-order match found only ${Math.round(matchRatio * 100)}% of its words, need ${Math.round(MIN_CLAIM_MATCH_RATIO * 100)}%) at or after the previous claim's position -- ` +
        "claims must appear in the same order as research/evidence_map.json lists them, matching the real narration"
    );
  }
  return { matchStart: tokens[best.firstIndex].start, matchEnd: tokens[best.lastIndex].end, nextSearchTokenIndex: best.lastIndex + 1 };
}

// How far (as a fraction of the ideal equal-width slice length) a boundary
// SEARCHES around its exact time-fraction point for a real word end to
// land on. This alone does not bound the resulting slice width -- two
// adjacent free boundaries could each drift outward from the slice between
// them -- so sliceClaimWindow enforces the real per-shot cap directly and
// sequentially instead: each boundary's search window is capped at
// `start + maxShotSeconds` using the ACTUAL real start already produced by
// the previous boundary (not an idealized/symmetric estimate), so every
// resulting slice is guaranteed at or under maxShotSeconds regardless of
// how far its neighbors already drifted. That lets this fraction stay
// generous (real speech needs real room to offer a nearby word end) without
// ever risking an over-cap shot.
const BOUNDARY_WOBBLE_FRACTION = 0.4;
const SENTENCE_BOUNDARY_BONUS = 1.4;
const CLAUSE_BOUNDARY_BONUS = 0.7;
const PAUSE_ANCHOR_BONUS = 1;
const PAUSE_ANCHOR_TOLERANCE_SECONDS = 0.75;
// A candidate that would make this slice's own duration land within one
// frame (30fps) of an ALREADY-DETERMINED neighboring slice's duration --
// one that's either already finalized (looking backward) or already fully
// fixed independent of this choice (looking forward -- see avoidDurations
// in sliceClaimWindow) -- risks completing orvyq_pacing_audit.mjs's own
// "3 identical durations in a row" failure.
// This never overrides which candidates are ELIGIBLE (still only real word
// timestamps within the technical/pause-safe window) -- it only breaks a
// near-tie among them in favor of the one that doesn't recreate that exact
// failure, so it can't manufacture variety pickRealBoundary wouldn't
// otherwise have picked from real content.
const DUPLICATE_NEIGHBOR_PENALTY = 0.5;
const DUPLICATE_NEIGHBOR_TOLERANCE_SECONDS = 1 / 30;

// Mirrors scripts/orvyq_mobile_legibility_audit.mjs's own IMAGE_KINDS set
// (duplicated there too, same as scripts/orvyq_edit_plan.mjs and
// scripts/orvyq_real_asset_coverage_audit.mjs -- an established pattern in
// this codebase rather than a shared import) and its ">= 4s" floor for any
// shot of one of these kinds: real document/figure pages need enough
// on-screen time to actually be read on a phone. Narration-boundary
// placement above has no notion of this floor on its own -- it only
// follows real speech structure -- so a claim's evidence_kind_overrides
// slice can otherwise land under 4s purely because that's where the real
// narration happened to divide.
const IMAGE_KINDS = new Set(["split_documents", "official_document", "official_figure", "official_screen", "image_sequence", "recap"]);
const MIN_IMAGE_EVIDENCE_SECONDS = 4;
// A small buffer above the audit's own hard "< 4" cutoff: quantizeShotsToFrames
// (later, once per-shot durations are finalized) rounds every shot to the
// nearest frame, which could round a razor-thin 4.00s slice back under
// 4.00s. 0.1s is a comfortable multiple of one frame (1/30s) either way.
const IMAGE_EVIDENCE_FLOOR_SECONDS = MIN_IMAGE_EVIDENCE_SECONDS + 0.1;
// The lowest a donor slice (one lending real seconds to an undersized
// image-evidence slice next to it) is allowed to shrink to -- keeps a
// donor from being squeezed down to an absurd sliver just to satisfy its
// neighbor's floor. Comfortably below TARGET_SHOT_SECONDS (6s), well above
// zero.
const MIN_DONOR_SECONDS_AFTER_LENDING = 2;

// Widens checkpointTimes[sliceIndex..sliceIndex+1] up to
// IMAGE_EVIDENCE_FLOOR_SECONDS by moving ONLY that slice's own two
// boundaries -- never a checkpoint further away -- so every other slice's
// width is unaffected except whichever single immediate neighbor actually
// lends time. A FIXED checkpoint (claim edge, frozen evidence-run edge, or
// pause-pinned edge) is never moved, preserving every invariant those exist
// for exactly as before; lending is capped so a donor never drops below
// MIN_DONOR_SECONDS_AFTER_LENDING. Best-effort only -- does not throw on its
// own: when a claim has more than one slice needing this floor, an earlier
// slice's growth can borrow from a checkpoint a later slice also needs to
// borrow from, undoing part of the earlier fix. The caller re-checks every
// target slice's FINAL width once all of them have been processed and fails
// loudly there instead, since only the end state (not any one slice in
// isolation) can tell whether every slice's floor was really satisfied.
// Mutates checkpointTimes in place.
function growImageEvidenceSliceToFloor(checkpointTimes, sliceIndex, isFixedCheckpoint) {
  const leftCheckpoint = sliceIndex;
  const rightCheckpoint = sliceIndex + 1;
  let deficit = IMAGE_EVIDENCE_FLOOR_SECONDS - (checkpointTimes[rightCheckpoint] - checkpointTimes[leftCheckpoint]);
  if (deficit <= 0) return;

  const leftFixed = isFixedCheckpoint(leftCheckpoint);
  const rightFixed = isFixedCheckpoint(rightCheckpoint);
  const rightDonorRoom = rightFixed ? 0 : Math.max(0, checkpointTimes[rightCheckpoint + 1] - checkpointTimes[rightCheckpoint] - MIN_DONOR_SECONDS_AFTER_LENDING);
  const leftDonorRoom = leftFixed ? 0 : Math.max(0, checkpointTimes[leftCheckpoint] - checkpointTimes[leftCheckpoint - 1] - MIN_DONOR_SECONDS_AFTER_LENDING);

  const fromRight = Math.min(deficit, rightDonorRoom);
  checkpointTimes[rightCheckpoint] += fromRight;
  deficit -= fromRight;

  if (deficit > 0) {
    const fromLeft = Math.min(deficit, leftDonorRoom);
    checkpointTimes[leftCheckpoint] -= fromLeft;
  }
}

// direction/sequence_plan.json has no equivalent of this yet -- a
// GRAPHIC_BREAK_ASSIGNMENTS entry's own optional `maxSeconds` caps that
// specific claim_recap_card's on-screen duration, giving the saved time to
// whichever immediate neighbor slice has room. A graphic recap card exists
// purely to interrupt an evidence run under the cap (see
// GRAPHIC_BREAK_ASSIGNMENTS' own header comment) -- its natural narration-
// boundary width has no relationship to how long a full-screen title/
// subtitle actually needs to stay legible, which is exactly the same real
// premise scripts/orvyq_tension_card_audit.mjs's own 2.5-4.5s "typical"
// band already established for the structurally similar pause-driven
// emphasis card. Unlike growImageEvidenceSliceToFloor, this never leaves a
// neighbor over maxShotSeconds -- it throws instead, since (unlike a
// best-effort floor) silently skipping the cap would ship exactly the
// generic-card-fraction overage this exists to fix. Mutates checkpointTimes
// in place.
// direction/sequence_plan.json's evidence_kind_overrides[claim_id] declares
// a real materialized image set for a claim's native evidence slices. The
// default (distinct_image_per_occurrence unset/false) attaches the FULL
// declared image set to EVERY matching slice -- correct when a claim's
// evidence-slice count matches its declared-image count, since each slice
// then legibly holds the whole set, but it produces two consecutive shots
// with an IDENTICAL evidence.image_assets set when a claim's evidence
// slices end up truly adjacent in the final film, which
// scripts/orvyq_semantic_visual_audit.mjs correctly rejects as a duplicate.
// Setting distinct_image_per_occurrence cycles exactly one image per
// occurrence instead (by occurrence index, wrapping if there are more
// occurrences than images) -- opt-in per claim, so every override without
// this flag keeps its exact prior fan-out-all behavior unchanged.
export function resolveEvidenceOverrideAssets(kindOverride, evidenceKind, occurrence) {
  if (!kindOverride || kindOverride.kind !== evidenceKind) return {};
  const evidenceAssetIds = kindOverride.evidence_asset_ids || [];
  const imageAssets = kindOverride.image_assets || [];
  if (evidenceAssetIds.length !== imageAssets.length)
    throw new Error(`evidence_kind_overrides ${evidenceKind} must pair every evidence_asset_id with one image_asset`);

  // Some project profiles require the first post-hook evidence shot to show a
  // small, explicit set of real documents/figures at once. The remaining
  // occurrences still rotate one image each, starting after that opening set,
  // so no source silently exceeds the global reuse cap.
  const firstOccurrenceAssetCount = Math.max(0, Math.round(Number(kindOverride.first_occurrence_asset_count) || 0));
  if (occurrence === 0 && firstOccurrenceAssetCount > 0) {
    if (firstOccurrenceAssetCount > evidenceAssetIds.length)
      throw new Error(`first_occurrence_asset_count=${firstOccurrenceAssetCount} exceeds the ${evidenceAssetIds.length} declared evidence assets`);
    return {
      evidence_asset_ids: evidenceAssetIds.slice(0, firstOccurrenceAssetCount),
      image_assets: imageAssets.slice(0, firstOccurrenceAssetCount)
    };
  }
  if (kindOverride.distinct_image_per_occurrence && evidenceAssetIds.length) {
    const rotationOffset = firstOccurrenceAssetCount > 0 ? firstOccurrenceAssetCount - 1 : 0;
    const index = (occurrence + rotationOffset) % evidenceAssetIds.length;
    return { evidence_asset_ids: [evidenceAssetIds[index]], image_assets: [imageAssets[index]] };
  }
  return { evidence_asset_ids: evidenceAssetIds, image_assets: imageAssets };
}

export function shrinkGraphicBreakSliceToMax(checkpointTimes, sliceIndex, maxSeconds, isFixedCheckpoint, maxShotSeconds, claimId) {
  const leftCheckpoint = sliceIndex;
  const rightCheckpoint = sliceIndex + 1;
  const width = checkpointTimes[rightCheckpoint] - checkpointTimes[leftCheckpoint];
  const excess = width - maxSeconds;
  if (excess <= 0) return;

  const leftFixed = isFixedCheckpoint(leftCheckpoint);
  const rightFixed = isFixedCheckpoint(rightCheckpoint);
  const rightNeighborWidth = rightFixed ? Infinity : checkpointTimes[rightCheckpoint + 1] - checkpointTimes[rightCheckpoint];
  const leftNeighborWidth = leftFixed ? Infinity : checkpointTimes[leftCheckpoint] - checkpointTimes[leftCheckpoint - 1];
  const rightRoom = rightFixed ? 0 : Math.max(0, maxShotSeconds - rightNeighborWidth);
  const leftRoom = leftFixed ? 0 : Math.max(0, maxShotSeconds - leftNeighborWidth);

  if (rightRoom + leftRoom + 1e-9 < excess) {
    throw new Error(
      `${claimId}: cannot shrink its graphic recap slice ${sliceIndex} to ${maxSeconds}s -- neighboring capacity ${rightRoom + leftRoom}s is below the required ${excess}s under the ${maxShotSeconds}s per-shot cap (leftFixed=${leftFixed}, rightFixed=${rightFixed})`
    );
  }
  const toRight = Math.min(excess, rightRoom);
  checkpointTimes[rightCheckpoint] -= toRight;
  checkpointTimes[leftCheckpoint] += excess - toRight;
}

// Picks the real word-end time closest to idealTime (the exact
// equal-fraction split point) within [minTime, maxTime], softly preferring
// one that is ALSO a real sentence ending, then a real clause/punctuation
// break, then one that falls near an already-resolved editorial pause
// anchor (direction/editorial_pause_map.json, via resolveFullFilmPauses) --
// these are all genuine structural signals already present in the real
// narration, not fabricated. The bonus is soft (added to, not gating,
// nearness to idealTime) so a much closer plain word boundary still wins
// over a far-off sentence end; falls back to idealTime itself (the plain
// equal-fraction point, identical to this function's caller's old
// behavior) when no real word end exists in range at all.
function pickRealBoundary(tokensInWindow, idealTime, minTime, maxTime, pauseAnchorTimes, cursor, avoidDurations) {
  let best = null;
  let bestScore = -Infinity;
  const consider = (time, bonus) => {
    if (time <= minTime || time >= maxTime) return;
    let penalty = 0;
    if (avoidDurations && avoidDurations.length) {
      const duration = time - cursor;
      if (avoidDurations.some((avoid) => Math.abs(duration - avoid) < DUPLICATE_NEIGHBOR_TOLERANCE_SECONDS)) penalty = DUPLICATE_NEIGHBOR_PENALTY;
    }
    const score = bonus - penalty - Math.abs(time - idealTime);
    if (score > bestScore) {
      bestScore = score;
      best = time;
    }
  };
  const pauseBonusAt = (time) => (pauseAnchorTimes.some((anchorTime) => Math.abs(time - anchorTime) <= PAUSE_ANCHOR_TOLERANCE_SECONDS) ? PAUSE_ANCHOR_BONUS : 0);
  for (const token of tokensInWindow) {
    let endBonus = 0;
    if (endsAtSentenceBoundary(token.raw)) endBonus = SENTENCE_BOUNDARY_BONUS;
    else if (endsAtClauseBoundary(token.raw)) endBonus = CLAUSE_BOUNDARY_BONUS;
    consider(token.end, endBonus + pauseBonusAt(token.end));
    // A word's own START is just as real a speech landmark as its END (the
    // silence/breath immediately preceding it) -- considering both roughly
    // doubles how many genuine candidate points a tight window has to work
    // with, without inventing anything: every candidate is still a real
    // ASR timestamp already present in this claim's own narration.
    consider(token.start, pauseBonusAt(token.start));
  }
  return best ?? idealTime;
}

// The 0-based slice indices of one claim that a hand-authored
// FOOTAGE_ASSIGNMENTS or GRAPHIC_BREAK_ASSIGNMENTS entry already claims
// (a footage span covers `span` contiguous indices starting at its own
// key). sliceClaimWindow uses this to keep every boundary touching one of
// these slices frozen at its exact equal-fraction point -- see
// sliceClaimWindow's own docstring for why.
function protectedSliceIndices(claimId) {
  const indices = new Set();
  const footageTable = FOOTAGE_ASSIGNMENTS[claimId];
  if (footageTable) {
    for (const [startIndexRaw, assignment] of Object.entries(footageTable)) {
      const startIndex = Number(startIndexRaw);
      const span = Math.max(1, Math.round(Number(assignment.span) || 1));
      for (let offset = 0; offset < span; offset += 1) indices.add(startIndex + offset);
    }
  }
  const graphicTable = GRAPHIC_BREAK_ASSIGNMENTS[claimId];
  if (graphicTable) for (const sliceIndex of Object.keys(graphicTable)) indices.add(Number(sliceIndex));
  return indices;
}

// Which internal boundaries (boundary i sits between slice i and slice
// i+1) sliceClaimWindow must NOT move, so that buildFullProductionPlan's
// own uninterrupted-evidence-run check (the "asset_type !== 'evidence'
// resets the run, otherwise accumulate shots[i].duration" loop later in
// this file) computes EXACTLY the same run lengths it did before this
// boundary-snapping fix existed.
//
// That check only cares about the TOTAL duration of each maximal run of
// consecutive plain EVIDENCE slices (footage/graphic shots reset it, but
// their own total duration is never itself measured against anything) --
// not how that evidence total is subdivided internally. So only an
// evidence run's own two outer edges need to stay fixed when it has 2+
// slices (they are what separates ITS total from its neighboring
// footage/graphic run); every other boundary -- strictly inside a
// multi-slice evidence run, anywhere inside a footage/graphic run
// (including a multi-slice FOOTAGE_ASSIGNMENTS span), or bordering an
// ISOLATED single evidence slice -- can move freely. A length-1 evidence
// run's own duration is already bounded by maxShotSeconds (always far
// under the 15s run cap), so wobbling either of its edges cannot create a
// coverage-gap regression; and a footage/graphic run's own two edges only
// need freezing when the run on the OTHER side of one of them is itself a
// multi-slice evidence run -- which that evidence run's own protection
// already covers. This asymmetry (only evidence-run edges matter) is what
// leaves CLM_009/CLM_018/CLM_020-style claims (footage/graphic interleaved
// almost every slice, see FOOTAGE_ASSIGNMENTS/GRAPHIC_BREAK_ASSIGNMENTS
// above) real room for duration variety -- treating footage-run edges as
// equally sacred left such claims with almost no movable boundaries at all.
function frozenRunEdgeBoundaries(protectedIndices, sliceCount) {
  const frozen = new Set();
  let runStart = 0;
  for (let i = 1; i <= sliceCount; i += 1) {
    if (i < sliceCount && protectedIndices.has(i) === protectedIndices.has(runStart)) continue;
    const runEnd = i - 1;
    const isEvidenceRun = !protectedIndices.has(runStart);
    if (isEvidenceRun && runEnd - runStart + 1 >= 2) {
      if (runStart > 0) frozen.add(runStart - 1);
      if (runEnd < sliceCount - 1) frozen.add(runEnd);
    }
    runStart = i;
  }
  return frozen;
}

// Splits one claim's real coverage window into the minimum number of
// slices needed to keep every slice at or under maxShotSeconds -- the slice
// COUNT is a technical necessity (the renderer/schema cap a single shot's
// length), not a creative decision, and is untouched by this function's
// boundary-placement choice below it. There is deliberately no fabricated
// duration jitter here: every interior boundary starts at the exact
// equal-fraction point (idealTime) and is then, at most, nudged onto a
// REAL word-end timestamp already present in this claim's own narration
// (see pickRealBoundary) -- sentence endings, clause/punctuation breaks and
// existing editorial pause anchors are preferred in that order, but a
// boundary can never move further than BOUNDARY_WOBBLE_FRACTION of the
// ideal slice width, and never past maxShotSeconds from its neighbor.
// Without real tokens in range (or when the words happen to fall exactly
// on the ideal fraction, or a claim has only one slice) this produces
// identical equal-width slices to before; variety only appears where real
// speech actually offers a nearby boundary to land on, so
// scripts/orvyq_pacing_audit.mjs's "no 3 identical durations in a row" rule
// is still enforced honestly against whatever real narration produces, not
// gamed by nudging durations toward arbitrary/random values.
//
// Critically, a boundary is only ever eligible for this nudge when it is
// NOT one of frozenRunEdgeBoundaries' outer edges (see that function) --
// i.e. it does not separate a multi-slice (2+) run of consecutive plain
// EVIDENCE slices from its neighboring footage/graphic run. That is
// exactly, and only, what buildFullProductionPlan's own
// uninterrupted-evidence-run coverage-gap check measures (an evidence
// run's total duration, reset on every non-evidence asset_type -- a
// footage/graphic run's own total is never itself measured against
// anything), so freezing just those edges preserves that check's numbers
// -- and therefore every fraction/ceiling
// scripts/orvyq_semantic_visual_audit.mjs computes from those same real
// seconds -- exactly. Every other boundary is free to move: strictly
// inside a multi-slice evidence run, anywhere inside a footage/graphic run
// (including a multi-slice FOOTAGE_ASSIGNMENTS span), or bordering an
// isolated single evidence slice. This is where the real
// 3-identical-durations-in-a-row pacing failures come from, including in
// claims where footage/graphic breaks are interleaved almost every slice
// (every evidence slice there is its own isolated length-1 run, so nothing
// needs freezing at all).
//
// Every slice defaults to plain "evidence" (this claim's own primary
// visual_treatment, via kindFor) -- there is no automatic evidence -> context
// -> metaphor rotation and no automatic "boundary" tension card, and no
// positional restriction on which slice may become footage: a slice becomes
// footage/context only if buildFullProductionPlan finds a matching,
// hand-authored FOOTAGE_ASSIGNMENTS[claim_id][sliceIndex] entry for its own
// real 0-based index in the array this function returns -- any index is
// eligible, not just a fixed "every third slice" position. Everything else
// stays real, source-backed evidence.
//
// One slice MORE than the technical minimum (Math.ceil(duration/cap)) may
// be declared here for a specific claim: real per-slice headroom under
// maxShotSeconds shrinks as duration/cap approaches an exact multiple of
// cap, and for CLM_020_SYSTEMIC_INCENTIVE_FINAL specifically (this film's
// single longest claim, ~135s) the technical-minimum slice count leaves so
// little real headroom (~0.05-0.12s per boundary, most of it consumed by
// upstream drift within the same run of free boundaries) that several
// consecutive real ASR word timestamps (checked against both word-starts
// and word-ends) never land inside the safe window at all -- confirmed
// directly, not assumed. One additional slice roughly triples that
// headroom, without changing which asset/trim/motion/role any existing
// FOOTAGE_ASSIGNMENTS entry declares (only the two highest slice indices in
// CLM_020's own table above were re-keyed by +1 to match).
// Per-project slice-count overrides are loaded from config/editorial_asset_plan.json.


export function sliceClaimWindow(claim, coverStart, coverEnd, maxShotSeconds, tokens = [], pauseAnchorTimes = [], evidenceKindOverrides = {}) {
  const duration = coverEnd - coverStart;
  const technicalMinimumSliceCount = Math.max(1, Math.ceil(duration / Math.min(maxShotSeconds, TARGET_SHOT_SECONDS + 2)));
  const sliceCount = Math.max(technicalMinimumSliceCount, SLICE_COUNT_OVERRIDES[claim.claim_id] || 0);
  const sliceSeconds = duration / sliceCount;
  const wobble = sliceSeconds * BOUNDARY_WOBBLE_FRACTION;
  const protectedIndices = protectedSliceIndices(claim.claim_id);
  const frozenBoundaries = frozenRunEdgeBoundaries(protectedIndices, sliceCount);
  const tokensInWindow = sliceCount > 1 ? tokens.filter((token) => token.start > coverStart && token.end < coverEnd) : [];

  // A "checkpoint" is a slice boundary position: checkpoint 0 is
  // coverStart, checkpoint sliceCount is coverEnd, and checkpoint c for
  // 0 < c < sliceCount sits at boundary (c-1) (between slice c-1 and slice
  // c). A checkpoint is FIXED -- always exactly its equal-fraction
  // idealTime/coverEnd, never adjusted -- at the claim's own two edges, at
  // every frozenRunEdgeBoundaries outer edge, and at both edges of whatever
  // slice ALREADY contains a real pause under pure equal division (see
  // pausePinnedIndices below). Every other checkpoint is free to move.
  // idealAt(sliceCount) === coverEnd exactly (sliceSeconds is
  // duration/sliceCount by construction), so the two never disagree.
  const idealAt = (checkpoint) => coverStart + sliceSeconds * checkpoint;
  // A resolved editorial pause must land in the same shot it always did
  // (buildFullProductionPlan's second pass matches each pause to whichever
  // raw shot's [start,end) contains its source_time_seconds, and requires
  // that shot to be footage) -- so the slice pure equal division already
  // assigns each in-range pause to must not move AT ALL, on either edge.
  // This is deliberately a hard pin, not a soft per-step search constraint:
  // a pause many slices away from an earlier free boundary can't be
  // protected by comparing against a search reference that itself drifts
  // as free boundaries accumulate real-word snaps -- pinning the
  // pause-containing slice's own two edges sidesteps that entirely, and
  // (as a useful side effect) also caps how far drift can ever travel
  // between two real anchors.
  const pausePinnedIndices = new Set();
  for (const pauseTime of pauseAnchorTimes) {
    if (pauseTime <= coverStart || pauseTime >= coverEnd) continue;
    const sliceIndex = Math.min(sliceCount - 1, Math.max(0, Math.floor((pauseTime - coverStart) / sliceSeconds)));
    pausePinnedIndices.add(sliceIndex);
  }
  const isFixedCheckpoint = (checkpoint) =>
    checkpoint === 0 || checkpoint === sliceCount || frozenBoundaries.has(checkpoint - 1) || pausePinnedIndices.has(checkpoint - 1) || pausePinnedIndices.has(checkpoint);

  // Processing checkpoints as independent SEGMENTS between fixed points
  // (rather than one single left-to-right sweep) is what actually keeps a
  // fixed checkpoint exactly at idealAt(): a single sweep's per-boundary
  // maxShotSeconds safety clamp could otherwise still nudge a "frozen"
  // checkpoint off its exact value when an earlier FREE checkpoint (in the
  // same sweep) drifted enough to make the cap bind on arrival -- which
  // would silently break the run-length invariant frozenRunEdgeBoundaries
  // exists to protect. A segment's own fixed end can never be disturbed
  // because nothing after it is ever written while filling this segment.
  // Every FREE checkpoint inside a segment is placed against a locally
  // re-centered ideal point (see localIdeal below), not the claim's
  // original global equal-fraction grid -- see that comment for why a
  // fallback pinned to the global grid can become infeasible after enough
  // earlier drift in the same segment.
  const checkpointTimes = new Array(sliceCount + 1);
  checkpointTimes[0] = coverStart;
  checkpointTimes[sliceCount] = coverEnd;

  let segmentStart = 0;
  for (let checkpoint = 1; checkpoint <= sliceCount; checkpoint += 1) {
    if (!isFixedCheckpoint(checkpoint)) continue;
    if (checkpoint < sliceCount) checkpointTimes[checkpoint] = idealAt(checkpoint);
    const segmentEnd = checkpointTimes[checkpoint];
    let cursor = checkpointTimes[segmentStart];
    for (let j = segmentStart + 1; j < checkpoint; j += 1) {
      // Re-centered against the ACTUAL cursor (not the claim's original
      // global equal-fraction grid): equal division of whatever real span
      // is still left in this segment, into however many slices are still
      // left to place. This is what keeps the fallback always feasible
      // even after earlier free checkpoints in this same segment already
      // drifted -- a fallback pinned to the original global idealAt(j)
      // could otherwise land outside [cursor, cursor+maxShotSeconds] once
      // enough accumulated drift had passed, which the final safety clamp
      // below would then silently corrupt by moving it back onto the
      // WRONG side of an intervening pause. remainingSliceCount (this
      // slice plus every one still to come up to segmentEnd) and floor
      // both being derived the same way each step is what makes this
      // provably safe by induction: if cursor already satisfies
      // segmentEnd-cursor <= remainingSliceCount*maxShotSeconds (true at
      // segmentStart, since segmentStart/segmentEnd are exact multiples of
      // sliceSeconds), the same holds after clamping this step's own
      // choice into [floor, cursor+maxShotSeconds].
      const remainingAfter = checkpoint - j;
      const remainingSliceCount = remainingAfter + 1;
      const localIdeal = cursor + (segmentEnd - cursor) / remainingSliceCount;
      const floor = segmentEnd - remainingAfter * maxShotSeconds;
      const technicalMinTime = Math.max(cursor, floor);
      const technicalMaxTime = Math.min(segmentEnd, cursor + maxShotSeconds);
      // Durations to softly steer this slice's own width away from --
      // real word-timestamp candidates are never excluded by this, only
      // deprioritized among near-equally-good ones (see
      // DUPLICATE_NEIGHBOR_PENALTY). Backward: the two immediately
      // preceding slices are already finalized (checkpointTimes[0..j-1]
      // are all set by now); if they already tie each other, matching
      // them a third time is exactly orvyq_pacing_audit.mjs's own
      // failure. Forward: if this slice's own right neighbor (checkpoint
      // j+1) is fixed, and the checkpoint after THAT is fixed too, that
      // neighbor's width is already fully determined independent of
      // anything chosen here (both its own edges are pure idealAt()/
      // coverEnd values) -- avoiding a tie with it up front is exactly
      // what CLM_020's real closing-pause-pinned pair needed.
      const avoidDurations = [];
      if (j - 2 >= 0) {
        const priorDuration = checkpointTimes[j - 1] - checkpointTimes[j - 2];
        if (j - 3 >= 0 && Math.abs(priorDuration - (checkpointTimes[j - 2] - checkpointTimes[j - 3])) < DUPLICATE_NEIGHBOR_TOLERANCE_SECONDS) avoidDurations.push(priorDuration);
      }
      if (isFixedCheckpoint(j + 1)) {
        const nextFixedTime = idealAt(j + 1);
        const afterNextTime = j + 2 === sliceCount ? coverEnd : j + 2 < sliceCount && isFixedCheckpoint(j + 2) ? idealAt(j + 2) : null;
        if (afterNextTime !== null) avoidDurations.push(afterNextTime - nextFixedTime);
      }
      let end;
      if (tokensInWindow.length > 0) {
        const minTime = Math.max(technicalMinTime, localIdeal - wobble);
        const maxTime = Math.min(technicalMaxTime, localIdeal + wobble);
        end = maxTime > minTime ? pickRealBoundary(tokensInWindow, localIdeal, minTime, maxTime, pauseAnchorTimes, cursor, avoidDurations) : localIdeal;
      } else {
        end = localIdeal;
      }
      end = Math.min(end, technicalMaxTime);
      end = Math.max(end, technicalMinTime);
      checkpointTimes[j] = end;
      cursor = end;
    }
    segmentStart = checkpoint;
  }

  const slices = [];
  // direction/sequence_plan.json's evidence_kind_overrides[claim_id], when
  // present, routes every otherwise-plain-evidence slice of this claim to a
  // real materialized IMAGE_KINDS asset instead of kindFor()'s NATIVE_KINDS
  // default -- the direct fix for the confirmed root cause of the rejected
  // review's zero real evidence assets (kindFor() structurally never
  // returns an IMAGE_KINDS value on its own). The final shot-assembly pass
  // below attaches the override's real evidence_asset_ids/image_assets
  // whenever a slice's kind matches.
  const evidenceKindOverride = evidenceKindOverrides[claim.claim_id];
  const sliceKind = evidenceKindOverride?.kind || kindFor(claim.visual_treatment?.primary);

  // Only slices that will actually KEEP sliceKind need the floor: a
  // protected index (FOOTAGE_ASSIGNMENTS/GRAPHIC_BREAK_ASSIGNMENTS) gets
  // converted to footage/graphic by buildFullProductionPlan's own later
  // assignment pass and never uses sliceKind at all.
  if (evidenceKindOverride && IMAGE_KINDS.has(sliceKind)) {
    const imageFloorIndices = [];
    for (let i = 0; i < sliceCount; i += 1) if (!protectedIndices.has(i)) imageFloorIndices.push(i);
    for (const i of imageFloorIndices) growImageEvidenceSliceToFloor(checkpointTimes, i, isFixedCheckpoint);
    // growImageEvidenceSliceToFloor is best-effort and local (see its own
    // comment on why): re-verify every target slice's FINAL width once all
    // of them have been processed, since an earlier slice's fix can be
    // partially undone by a later slice borrowing back from the same
    // shared checkpoint.
    for (const i of imageFloorIndices) {
      const width = checkpointTimes[i + 1] - checkpointTimes[i];
      if (width >= MIN_IMAGE_EVIDENCE_SECONDS) continue;
      // The claim's LAST slice has no sibling further right to borrow
      // from within this same claim (a single-slice claim has no sibling
      // at all -- both its edges are the claim's own fixed boundary, so
      // growImageEvidenceSliceToFloor above could not lend it anything).
      // Rather than fail the whole candidate over a claim whose real
      // narration is simply too short to host both this claim's other
      // fixed obligations (e.g. a section's title card) AND a legible
      // real-document hold, this shot is allowed to visually persist past
      // this claim's own coverEnd, into the immediately following claim's
      // narration -- a genuine "hold" (the evidence remains attributed to
      // THIS claim; only the next claim's own coverStart is pushed later
      // to compensate, by the caller, once it sees this slice's returned
      // end exceeds the coverEnd it passed in). Only the true last slice
      // is eligible: an interior slice short on both sides has no real
      // narration direction left to extend into without also disturbing a
      // LATER slice of this same claim, which is out of scope here.
      if (i === sliceCount - 1) {
        checkpointTimes[sliceCount] += IMAGE_EVIDENCE_FLOOR_SECONDS - width;
        continue;
      }
      throw new Error(
        `${claim.claim_id}: cannot keep slice ${i} (kind "${sliceKind}") at or above the required ${MIN_IMAGE_EVIDENCE_SECONDS}s real-document minimum -- neighboring slices do not have enough spare real narration seconds to lend without violating other invariants; this claim's evidence_kind_overrides may need a different slice-count or assignment strategy`
      );
    }
  }

  // GRAPHIC_BREAK_ASSIGNMENTS[claim_id][sliceIndex].maxSeconds -- see
  // shrinkGraphicBreakSliceToMax's own comment. Only ever present on the
  // small number of entries scripts/orvyq_generic_card_audit.mjs's real
  // whole-film/per-section ceilings required capping; every other entry is
  // untouched (natural narration-boundary width, exactly as before).
  const graphicBreaksForClaim = GRAPHIC_BREAK_ASSIGNMENTS[claim.claim_id];
  if (graphicBreaksForClaim) {
    for (const [sliceIndexRaw, assignment] of Object.entries(graphicBreaksForClaim)) {
      if (!Number.isFinite(assignment.maxSeconds)) continue;
      shrinkGraphicBreakSliceToMax(checkpointTimes, Number(sliceIndexRaw), assignment.maxSeconds, isFixedCheckpoint, maxShotSeconds, claim.claim_id);
    }
  }

  for (let i = 0; i < sliceCount; i += 1) slices.push({ start: checkpointTimes[i], end: checkpointTimes[i + 1], kind: sliceKind });
  return slices;
}

// sliceClaimWindow's own last slice can extend past the coverEnd it was
// given (see its own comment on why) when a claim's real narration cannot,
// on its own, host both that claim's other fixed obligations (e.g. a
// section's title card) and a legible real-document evidence_kind_override
// hold -- a genuine "visual hold" past that claim's own narration, into the
// immediately following claim's. The evidence itself stays attributed to
// the ORIGINATING claim (its shot's claim_id is built from `windows[windowIndex]`
// regardless of this adjustment); only the next claim's own coverStart is
// pushed forward here by the exact amount borrowed, so no real narration
// second is ever double-counted (claimed by two claims' shots) or dropped
// (claimed by neither) -- exported standalone (rather than inlined in
// buildFullProductionPlan) so this real narration-budget arithmetic is
// testable without the full disk-reading pipeline. Mutates windows[windowIndex + 1]
// in place; returns the hold amount actually applied (0 if none was needed).
export function applyEvidenceHoldToNextWindow(windows, windowIndex, coverEnd, slices) {
  const holdSeconds = slices.length ? slices.at(-1).end - coverEnd : 0;
  if (holdSeconds <= 1e-9) return 0;
  const currentClaimId = windows[windowIndex].claim.claim_id;
  const nextWindow = windows[windowIndex + 1];
  if (!nextWindow)
    throw new Error(
      `${currentClaimId}: needs ${holdSeconds.toFixed(3)}s more than its own real narration window to reach the mobile-legibility floor, but it is the film's last claim -- there is no following claim to hold into`
    );
  nextWindow.coverStart += holdSeconds;
  if (nextWindow.coverEnd <= nextWindow.coverStart)
    throw new Error(
      `${currentClaimId}'s real-document hold needs ${holdSeconds.toFixed(3)}s from ${nextWindow.claim.claim_id}'s own narration window, leaving it with none -- this pair of claims needs a different evidence_kind_overrides or slice-count strategy`
    );
  return holdSeconds;
}

// Snaps every shot's duration to an exact frame boundary, and footage
// trims to match -- mutates `shots` in place and returns it.
//
// buildCanonicalEditPlan (scripts/orvyq_edit_plan.mjs) assigns every shot's
// start_frame/end_frame from a single cumulative Math.round(cursor * FPS)
// walk across the WHOLE film -- cursor itself is a running float, never
// itself rounded, only the frame numbers read off it are. A shot's own
// float `duration` can therefore drift from its real on-screen
// (frame-quantized) length by up to half a frame at each of its two
// boundaries, and those two independent roundings can combine to exceed
// scripts/orvyq_edit_plan_tests.mjs's 0.02s footage trim-vs-actual-length
// tolerance even when buildCanonicalEditPlan's own single-shot check (trim
// vs. the float duration alone, same 0.02s tolerance) already passed --
// both checks cannot be satisfied at once while `duration` itself carries
// sub-frame drift.
//
// The real fix is upstream of trims: round(x + n) = round(x) + n for any
// integer n, so once a shot's OWN `duration` is itself an exact whole
// number of frames, its contribution to ANY later cumulative
// Math.round(cursor * FPS) boundary is exactly that many frames --
// regardless of the cursor's value when this shot starts, including
// sub-frame drift already carried in from any untouched shots earlier in
// the same film (e.g. the real, separately-curated motion_hook.json
// footage that precedes `shots` in the final full_production.shots array).
// Using the exact float frames/fps here (not rounded to milliseconds)
// matters: rounding `duration` itself to 3 decimals would reintroduce a
// smaller version of the same cumulative-drift problem across 100+ shots.
export function quantizeShotsToFrames(shots, fps = FPS) {
  for (const shot of shots) {
    const frames = Math.round(shot.duration * fps);
    shot.duration = frames / fps;
    if (shot.asset_type === "footage") shot.trim_out_sec = Math.round((shot.trim_in_sec + frames / fps) * 1000) / 1000;
  }
  return shots;
}

export async function buildFullProductionPlan(projectId) {
  await loadEditorialAssetPlan(projectId);
  const dir = projectDir(projectId);
  const [blueprint, resolvedPausePlan, alignment, evidenceMap, motionHook, sequencePlan] = await Promise.all([
    readJson(path.join(dir, "direction", "editorial_blueprint.json")),
    // The candidate's real editorial pauses, resolved exactly once by
    // scripts/orvyq_resolve_pauses.mjs (run before this script in CI) --
    // see that script's own header for why this and orvyq_audio_mix.mjs
    // both read the same resolved artifact instead of each independently
    // calling resolveFullFilmPauses().
    readJson(path.join(dir, "direction", "resolved_pause_plan.json")),
    readJson(path.join(dir, "voice", "narration_alignment.json")),
    loadResolvedEvidenceMap(dir),
    readJson(path.join(dir, "direction", "motion_hook.json")),
    // direction/sequence_plan.json's evidence_kind_overrides -- the one
    // genuinely new authoring table this file reads from JSON rather than
    // a JS constant (see that schema's own description for why
    // FOOTAGE_ASSIGNMENTS/GRAPHIC_BREAK_ASSIGNMENTS/SLICE_COUNT_OVERRIDES
    // below stay as hand-authored code with their load-bearing rationale
    // comments intact).
    readJson(path.join(dir, "direction", "sequence_plan.json"))
  ]);
  const evidenceKindOverrides = sequencePlan.evidence_kind_overrides || {};

  const maxShotSeconds = blueprint.global_rules.max_shot_seconds;
  const validSourceIds = new Set(evidenceMap.source_catalog.map((source) => source.source_id));

  // loadResolvedEvidenceMap() appends evidence_resolutions.json's
  // claim_additions to the END of the claims array (Map insertion order),
  // regardless of which section they narratively belong to -- CLM_021 (a
  // real addition) belongs to SEC_04, well before the film's final
  // sections, but without this sort it would be located last, after the
  // forward-only cursor has already passed its real position. Sorting by
  // each claim's section's position in full_production.sections (a stable
  // sort, so claims already correctly ordered within the same section keep
  // their relative order) fixes this without needing to touch the
  // resolution-merge logic itself.
  const sectionOrder = new Map(blueprint.full_production.sections.map((section, index) => [section.section_id, index]));
  const usableClaims = evidenceMap.claims
    .filter((claim) => claim.status !== "removed")
    .map((claim, originalIndex) => ({ claim, originalIndex }))
    .sort((a, b) => {
      const sectionDelta = (sectionOrder.get(a.claim.section_id) ?? 0) - (sectionOrder.get(b.claim.section_id) ?? 0);
      return sectionDelta !== 0 ? sectionDelta : a.originalIndex - b.originalIndex;
    })
    .map(({ claim }) => claim);

  const tokens = tokenizeWords(alignment.words);
  const narrationEnd = alignment.words.at(-1).end;

  const { pauses } = resolvedPausePlan;
  if (!Array.isArray(pauses) || !pauses.length)
    throw new Error("direction/resolved_pause_plan.json has no pauses -- run scripts/orvyq_resolve_pauses.mjs first");
  // Real, already-resolved pause moments doubling as one of
  // sliceClaimWindow's real boundary-preference signals (see
  // pickRealBoundary) -- these are genuine editorial cut points, not
  // fabricated for this purpose.
  const pauseAnchorTimes = pauses.map((pause) => pause.source_time_seconds);

  // Real on-disk duration of every distinct footage clip FOOTAGE_ASSIGNMENTS
  // or FULL_FOOTAGE_POOL references, read from its own provenance companion
  // (validated by scripts/orvyq_materialize_footage.mjs) rather than
  // hardcoded, so a trim window can never silently drift from the actual
  // licensed source file.
  const assignedAssets = new Set([...FULL_FOOTAGE_POOL, ...Object.values(FOOTAGE_ASSIGNMENTS).flatMap((byOccurrence) => Object.values(byOccurrence).map((entry) => entry.asset))]);
  const assetDurationSeconds = new Map(
    await Promise.all(
      [...assignedAssets].map(async (asset) => {
        const provenance = await readJson(path.join(dir, `${asset}.provenance.json`));
        const duration = Number(provenance.actual_duration_seconds ?? provenance.duration);
        if (!Number.isFinite(duration) || duration <= 0) throw new Error(`${asset} provenance has no usable duration`);
        return [asset, duration];
      })
    )
  );

  // ---- locate every claim's real spoken window, forward-only, zero gaps ----
  let cursorTokenIndex = 0;
  const windows = [];
  for (const claim of usableClaims) {
    const { matchStart, matchEnd, nextSearchTokenIndex } = locateClaimWindow(tokens, claim, cursorTokenIndex);
    windows.push({ claim, matchStart, matchEnd });
    cursorTokenIndex = nextSearchTokenIndex;
  }
  // A single boundary per claim pair: claim i's coverage runs from the end
  // of its own quoted excerpt back to where the PREVIOUS claim's own quote
  // ended (i.e. coverEnd[i] = matchEnd[i], and coverStart[i+1] = coverEnd[i]
  // -- the same value, not two independently-computed ones). Using
  // matchStart of the NEXT claim for coverEnd (as an earlier version of
  // this function did) double-counts the connecting narration between two
  // claims: once as claim i's tail (up to claim i+1's quote start) AND
  // again as claim i+1's own lead-in (from claim i's quote end) -- the two
  // windows would overlap by that entire gap. Here, any narration between
  // one claim's quote and the next belongs to the LATER claim, as its own
  // lead-in.
  for (let i = 0; i < windows.length; i += 1) {
    windows[i].coverStart = i === 0 ? 0 : windows[i - 1].matchEnd;
    windows[i].coverEnd = i === windows.length - 1 ? narrationEnd : windows[i].matchEnd;
    if (windows[i].coverEnd <= windows[i].coverStart)
      throw new Error(`${windows[i].claim.claim_id} has a non-positive coverage window -- claims are out of narration order`);
  }

  // ---- raw shots in SOURCE (pre-pause) time: title cards + claim slices ----
  const sections = blueprint.full_production.sections;
  const sectionFirstClaim = new Map();
  for (const window of windows) if (!sectionFirstClaim.has(window.claim.section_id)) sectionFirstClaim.set(window.claim.section_id, window.claim.claim_id);

  const rawShots = [];
  let currentSection = null;
  let isFirstWindowOverall = true;
  // Section 1 keeps its dedicated full-screen title because it is also a
  // deliberate break between two opening evidence shots. Later section
  // titles are carried as overlays on their own source-backed evidence
  // transition shots. This preserves the exact timeline and section rhythm
  // without spending generic full-screen-card or contextual-footage budget.
  let pendingSectionOverlay = null;
  for (const [windowIndex, window] of windows.entries()) {
    const isNewSection = window.claim.section_id !== currentSection;
    // The film's real opening is the licensed motion hook (see below), which
    // must dissolve directly into primary evidence -- auditMotionHook
    // requires the very first post-hook shot to be asset_type "evidence",
    // not a graphic title card. So section 1 alone defers its title card
    // until right after that first evidence slice; every later section
    // still opens on its own title card as usual.
    const deferTitleCard = isNewSection && isFirstWindowOverall;
    let titleCardShot = null;
    if (isNewSection) {
      if (pendingSectionOverlay)
        throw new Error(`${currentSection}: section-title overlay was not consumed before ${window.claim.section_id}`);
      currentSection = window.claim.section_id;
      const section = sections.find((s) => s.section_id === currentSection);
      const sectionTitle = titleCase(currentSection);
      if (deferTitleCard) {
        titleCardShot = {
          kind: "graphic",
          section_id: currentSection,
          claim_id: sectionFirstClaim.get(currentSection),
          start: window.coverStart,
          end: window.coverStart + FIRST_SECTION_TITLE_SECONDS,
          graphic: {
            type: "section_title",
            mode: "brand",
            title: sectionTitle,
            subtitle: null,
            template_id: "orvyq_section_sting",
            necessity: "critical_result"
          },
          role: "graphic"
        };
      } else {
        rawShots.push({
          kind: "evidence",
          evidenceKind: "boundary",
          section_id: currentSection,
          claim_id: sectionFirstClaim.get(currentSection),
          start: window.coverStart,
          end: window.coverStart + TITLE_CARD_SECONDS,
          role: "evidence",
          overlay: {
            type: "boundary",
            eyebrow: `SECTION ${String(sections.findIndex((candidate) => candidate.section_id === currentSection) + 1).padStart(2, "0")}`,
            title: sectionTitle,
            font_px: 36,
            // This is a concise section sting, not a paragraph, quotation or
            // evidence-reading overlay. The pacing audit therefore evaluates
            // it under the authored 2.5s title-sting contract.
            reading_required: false
          }
        });
      }
      window.coverStart += deferTitleCard ? FIRST_SECTION_TITLE_SECONDS : TITLE_CARD_SECONDS;
    }
    const slices = sliceClaimWindow(window.claim, window.coverStart, window.coverEnd, maxShotSeconds, tokens, pauseAnchorTimes, evidenceKindOverrides);
    applyEvidenceHoldToNextWindow(windows, windowIndex, window.coverEnd, slices);
    const sliceDurations = slices.map((slice) => slice.end - slice.start);
    const footageBySlice = expandFootageAssignments(window.claim.claim_id, sliceDurations, assetDurationSeconds);
    const graphicBreaksForClaim = GRAPHIC_BREAK_ASSIGNMENTS[window.claim.claim_id];
    for (const [sliceIndex, slice] of slices.entries()) {
      const graphicBreak = graphicBreaksForClaim?.[sliceIndex];
      if (graphicBreak) {
        rawShots.push({
          kind: "graphic",
          section_id: window.claim.section_id,
          claim_id: window.claim.claim_id,
          start: slice.start,
          end: slice.end,
          sourceSliceIndex: sliceIndex,
          role: "graphic",
          semanticRationale: `Summarizes the precise comparison in ${window.claim.claim_id}; retained because the relationship cannot be read as quickly from footage alone.`,
          semanticLink: "conceptual",
          // mode: "brand" -- see the section_title graphic above for why
          // this is now explicit rather than relying on modeFor()'s
          // whitelist. A recap card that wants a real illustrative panel
          // instead of a plain title layout gets that as an explicit
          // graphicBreak.mode + labels (direction/sequence_plan.json's
          // graphic_mode_directives), never inferred.
          graphic: {
            type: "claim_recap_card",
            mode: graphicBreak.mode || "brand",
            ...(graphicBreak.labels ? { labels: graphicBreak.labels } : {}),
            title: graphicBreak.title,
            subtitle: graphicBreak.subtitle ?? null,
            template_id: graphicBreak.template_id || "orvyq_critical_result",
            necessity: graphicBreak.necessity || "critical_result"
          },
          dissolveIn: isFirstWindowOverall && sliceIndex === 0
        });
        if (deferTitleCard && sliceIndex === 0) rawShots.push(titleCardShot);
        continue;
      }
      const footageAssignment = footageBySlice.get(sliceIndex);
      if (footageAssignment) {
        rawShots.push({
          kind: "footage",
          section_id: window.claim.section_id,
          claim_id: window.claim.claim_id,
          start: slice.start,
          end: slice.end,
          sourceSliceIndex: sliceIndex,
          role: footageAssignment.role || "context",
          reuseReason: footageAssignment.reuseReason,
          semanticRationale: footageAssignment.semanticRationale,
          semanticLink: footageAssignment.semanticLink,
          asset: footageAssignment.asset,
          trimInSec: footageAssignment.trimInSec,
          trimOutSec: footageAssignment.trimOutSec,
          motion: footageAssignment.motion,
          dissolveIn: isFirstWindowOverall && sliceIndex === 0
        });
        if (deferTitleCard && sliceIndex === 0) rawShots.push(titleCardShot);
        continue;
      }
      // No authored footage assignment for this slice: it stays ordinary,
      // source-backed evidence -- never an automatic "metaphor" role or
      // "boundary" graphic (see sliceClaimWindow's docstring above).
      rawShots.push({
        kind: "evidence",
        evidenceKind: slice.kind,
        section_id: window.claim.section_id,
        claim_id: window.claim.claim_id,
        start: slice.start,
        end: slice.end,
        sourceSliceIndex: sliceIndex,
        role: "evidence",
        // Carries through to the shot spec's transition_in so it dissolves
        // directly out of the motion hook rather than defaulting to "cut".
        dissolveIn: isFirstWindowOverall && sliceIndex === 0
      });
      if (deferTitleCard && sliceIndex === 0) rawShots.push(titleCardShot);
    }
    isFirstWindowOverall = false;
  }

  // ---- second pass: insert real pause holds as their own dedicated shots ----
  // A pause must not simply extend its enclosing shot's duration -- that
  // shot could already be close to max_shot_seconds, and adding a 4-6s
  // pause on top would push it over the per-shot cap buildCanonicalEditPlan
  // enforces. Each pause becomes its own shot instead (holding the same
  // claim/kind/role, with the emphasis_card attached), inserted right after
  // the shot whose source-time range contains it, offsetting every
  // subsequent shot's output timing by the pause's real duration.
  let insertedSeconds = 0;
  let pauseCursor = 0;
  const finalShots = [];
  for (let i = 0; i < rawShots.length; i += 1) {
    const raw = rawShots[i];
    finalShots.push({ ...raw, outputStart: raw.start + insertedSeconds, outputEnd: raw.end + insertedSeconds, emphasis: null });
    // Title cards are a synthetic slice of bookkeeping time (not real
    // spoken narration), so a pause -- always anchored to a real word
    // timestamp -- should never conceptually land inside one; skip them
    // defensively anyway rather than emit an invalid graphic-typed pause
    // shot with no graphic content if a numeric edge case ever occurs.
    // Chained trim cursor: if MORE THAN ONE pause lands inside the same
    // enclosing shot's window (both of the film's own final two pauses land
    // back-to-back inside the same terminal shot), each subsequent pause
    // must continue from the PREVIOUS pause's own trim_out, not restart
    // from the enclosing shot's trim_out every time -- otherwise two
    // pauses sharing one enclosing shot would both read the identical
    // trim window and register as a second, non-contiguous use of that
    // asset (confirmed via a real CI failure: "exceeds the 2-use limit"
    // on an asset used only twice, once per claim, because its second
    // claim's own two trailing pauses were not chained).
    let pauseTrimCursor = raw.trimOutSec;
    while (
      raw.kind !== "graphic" &&
      pauseCursor < pauses.length &&
      pauses[pauseCursor].source_time_seconds <= raw.end + 1e-6 &&
      pauses[pauseCursor].source_time_seconds >= raw.start
    ) {
      const pause = pauses[pauseCursor];
      const pauseOutputStart = raw.end + insertedSeconds;
      const pauseTrimIn = pauseTrimCursor;
      const pauseTrimOut = Math.round((pauseTrimIn + pause.duration_seconds) * 1000) / 1000;
      finalShots.push({
        kind: raw.kind,
        evidenceKind: raw.evidenceKind,
        section_id: raw.section_id,
        claim_id: raw.claim_id,
        role: raw.role,
        sourceSliceIndex: raw.sourceSliceIndex ?? null,
        semanticRationale: raw.semanticRationale || null,
        semanticLink: raw.semanticLink || null,
        // A footage-kind pause hold becomes its own shot immediately
        // continuing the SAME clip from exactly where the enclosing shot's
        // trim (or the previous pause's own trim, if this is not the first
        // pause inside this shot) left off (rather than extending that
        // shot's own duration, which could push a single shot over
        // max_shot_seconds) -- the licensed footage keeps playing under the
        // narration pause(s) across contiguous shots. buildCanonicalEditPlan's
        // source-usage count (scripts/orvyq_edit_plan.mjs) treats a whole
        // chain of contiguous same-asset shots like this as one continuous
        // use, not several, so this never silently inflates a clip's
        // max_uses_per_source count for what is visually a single unbroken
        // shot.
        ...(raw.kind === "footage" ? { asset: raw.asset, trimInSec: pauseTrimIn, trimOutSec: pauseTrimOut, motion: raw.motion } : {}),
        outputStart: pauseOutputStart,
        outputEnd: pauseOutputStart + pause.duration_seconds,
        emphasis: pause
      });
      pauseTrimCursor = pauseTrimOut;
      insertedSeconds += pause.duration_seconds;
      pauseCursor += 1;
    }
  }
  if (pauseCursor !== pauses.length) throw new Error(`${pauses.length - pauseCursor} resolved pause(s) fell outside every shot's time range`);

  const totalDuration = narrationEnd + insertedSeconds;

  // A claim can be real editorial synthesis rather than a new factual
  // assertion (e.g. CLM_020_SYSTEMIC_INCENTIVE_FINAL's own
  // evidence_requirements: "Treat as the film's synthesis, visually built
  // from earlier verified evidence rather than a new factual claim") --
  // evidence_resolutions.json legitimately leaves such claims' source_ids
  // empty rather than attaching them to one arbitrary earlier source. But
  // buildCanonicalEditPlan still requires every evidence shot to carry
  // real, visible source attribution, and this must not be satisfied by
  // fabricating a source_id that was never actually cited. Since these
  // claims are explicitly a recap/montage of the film's own already-cited
  // evidence, attributing them to the real, deduplicated union of every
  // other usable claim's source_ids is truthful (it names exactly the
  // sources whose evidence is being recapped) without inventing anything.
  const recapSourceIds = [...new Set(usableClaims.flatMap((c) => c.source_ids || []).filter((id) => validSourceIds.has(id)))];

  // ---- assemble full_production.shots specs (buildCanonicalEditPlan's input shape) ----
  // research/evidence_map.json's own sections[] (title + dramatic_function),
  // NOT blueprint.full_production.sections (which only carries
  // target_seconds/music_state/visual_strategy/deliverables) -- the two
  // arrays share section_id keys but not shape.
  const sectionById = new Map(evidenceMap.sections.map((s) => [s.section_id, s]));
  const sourceById = new Map(evidenceMap.source_catalog.map((s) => [s.source_id, s]));
  // Counts how many shots have already been built for one (claim_id, kind)
  // pair so buildEvidenceContent can rotate which real fact leads each
  // repeat shot's eyebrow/title/body -- see scripts/lib/orvyq-evidence-
  // authoring.mjs. Keyed on the pair, not just claim_id, since a claim's
  // primary/secondary kinds are authored independently of each other.
  const evidenceOccurrenceByClaimKind = new Map();
  const shots = finalShots.map((shot, index) => {
    const duration = Math.round((shot.outputEnd - shot.outputStart) * 1000) / 1000;
    const narrationAnchor = narrationForRange(
      tokens,
      shot.start,
      shot.end,
      shot.emphasis?.anchor_text || (shot.kind === "graphic" ? shot.graphic?.title : shot.claim_id)
    );
    const base = {
      duration,
      claim_id: shot.claim_id,
      section_id: shot.section_id,
      scene_id: `scene_${String(sections.findIndex((s) => s.section_id === shot.section_id) + 1).padStart(3, "0")}`,
      visual_role: shot.role,
      editorial_purpose: shot.emphasis
        ? `Editorial pause beat: ${shot.emphasis.purpose || "emphasis hold"}.`.slice(0, 200)
        : `Present ${shot.claim_id.replace(/^CLM_\d+_/, "").replace(/_/g, " ").toLowerCase()} evidence for this section.`,
      narration_anchor: narrationAnchor,
      source_slice_index: shot.sourceSliceIndex ?? null,
      ...(shot.emphasis
        ? {
            emphasis_card: { eyebrow: (shot.emphasis.purpose || "EMPHASIS").toUpperCase().slice(0, 60), title: shot.emphasis.anchor_text, accent: null },
            // The real, authored sound cue for this exact pause anchor
            // (direction/editorial_pause_map.json's full_film_pause_anchors,
            // threaded through by resolveFullFilmPauses) -- not previously
            // carried from here into the blueprint shot spec at all, which
            // is why buildCanonicalEditPlan (scripts/orvyq_edit_plan.mjs)
            // had nothing to read and hardcoded sound_cue to null for every
            // shot, including emphasis beats that scripts/orvyq_edit_plan_
            // tests.mjs requires to carry a real "low_impact"/"tonal_bloom"
            // cue.
            sound_cue: shot.emphasis.sound_cue
          }
        : {}),
      ...(shot.dissolveIn ? { transition_in: "dissolve" } : {}),
      ...(shot.overlay ? { overlay: shot.overlay } : {})
    };
    if (shot.kind === "graphic") {
      return {
        ...base,
        asset_type: "graphic",
        graphic: shot.graphic,
        visual_role: "graphic",
        semantic_rationale:
          shot.semanticRationale ||
          `Marks the ${shot.section_id} transition without introducing a new factual claim; the card remains deliberately brief.`,
        semantic_link: shot.semanticLink || "conceptual"
      };
    }
    if (shot.kind === "footage") {
      return {
        ...base,
        asset_type: "footage",
        asset: shot.asset,
        trim_in_sec: shot.trimInSec,
        trim_out_sec: shot.trimOutSec,
        motion: shot.motion,
        hook_footage: false,
        contextual_footage: true,
        generic_stock: true,
        semantic_rationale:
          shot.semanticRationale ||
          `Shows the physical context named by ${shot.claim_id}; this assignment requires direct frame review before it may enter a candidate.`,
        semantic_link: shot.semanticLink || "physical",
        ...(shot.reuseReason ? { reuse_reason: shot.reuseReason } : {})
      };
    }
    const claim = usableClaims.find((c) => c.claim_id === shot.claim_id);
    const ownSourceIds = (claim.source_ids || []).filter((id) => validSourceIds.has(id));
    const isRecap = ownSourceIds.length === 0;
    const sourceIds = isRecap ? recapSourceIds : ownSourceIds;
    const occurrenceKey = `${shot.claim_id}:${shot.evidenceKind}`;
    const occurrence = evidenceOccurrenceByClaimKind.get(occurrenceKey) || 0;
    evidenceOccurrenceByClaimKind.set(occurrenceKey, occurrence + 1);
    const content = buildEvidenceContent({
      claim,
      kind: shot.evidenceKind,
      role: shot.role,
      displaySources: sourceIds.map((id) => sourceById.get(id)).filter(Boolean),
      ownSources: ownSourceIds.map((id) => sourceById.get(id)).filter(Boolean),
      section: sectionById.get(shot.section_id),
      occurrence
    });
    // A real materialized evidence image, never a fabricated one: only
    // attached when direction/sequence_plan.json's evidence_kind_overrides
    // declared this exact claim+kind pair (sliceKind above already came
    // from the same override, so this can only ever match a slice that
    // override actually produced). scripts/orvyq_edit_plan.mjs's own
    // IMAGE_KINDS validation (evidence_asset_ids resolve in
    // research/evidence_asset_manifest.json with status "ready", the
    // physical file exists) is the real, load-bearing gate downstream --
    // this only threads the override's declared real asset references
    // through, it does not itself verify readiness.
    const kindOverride = evidenceKindOverrides[shot.claim_id];
    const overrideAssets = resolveEvidenceOverrideAssets(kindOverride, shot.evidenceKind, occurrence);
    return {
      ...base,
      asset_type: "evidence",
      semantic_rationale: rationaleForEvidence(shot.claim_id, shot.evidenceKind),
      semantic_link: semanticLinkForEvidenceKind(shot.evidenceKind),
      evidence: {
        kind: shot.evidenceKind,
        source_ids: sourceIds,
        source_label: isRecap ? "Multiple verified sources (recap)" : evidenceMap.source_catalog.find((s) => s.source_id === ownSourceIds[0])?.publisher || "Source",
        font_px: DEFAULT_FONT_PX,
        ...content,
        template_id: `orvyq_${shot.evidenceKind}`,
        necessity:
          shot.evidenceKind === "source_timeline"
            ? "timeline"
            : shot.evidenceKind === "evidence_chain"
              ? "mechanism"
              : shot.evidenceKind === "comparison"
                ? "comparison"
                : "critical_result",
        ...overrideAssets
      }
    };
  });

  // ---- audit-only: uninterrupted evidence runs and pause placement ----
  // No automatic conversion happens here anymore -- there is no footage pool
  // to draw from and no graphic-tension-card fallback. Both checks are
  // read-only: if the film's real, hand-authored FOOTAGE_ASSIGNMENTS
  // coverage is not enough to keep every evidence run under the cap, or to
  // land every narration pause on footage, the build fails with a specific,
  // actionable report (claim_id + real time window) instead of silently
  // inventing a fix. A human editor resolves this by adding a
  // FOOTAGE_ASSIGNMENTS entry (or, if the licensed pool genuinely lacks a
  // fitting clip, by acquiring one) -- not by re-running this script.
  const MAX_EVIDENCE_RUN_SECONDS = Number(blueprint.global_rules?.max_uninterrupted_evidence_seconds) || 15;
  const missingCoverage = [];

  let runSeconds = 0;
  let runStartIndex = -1;
  for (let i = 0; i < shots.length; i += 1) {
    if (shots[i].asset_type !== "evidence") {
      runSeconds = 0;
      runStartIndex = -1;
      continue;
    }
    if (runStartIndex === -1) runStartIndex = i;
    runSeconds += shots[i].duration;
    if (runSeconds > MAX_EVIDENCE_RUN_SECONDS) {
      const first = shots[runStartIndex];
      const last = shots[i];
      missingCoverage.push(
        `Uninterrupted evidence run of ${runSeconds.toFixed(1)}s (> ${MAX_EVIDENCE_RUN_SECONDS}s cap) from ${first.shot_id || first.claim_id} to ${last.shot_id || last.claim_id} ` +
          `(claims ${[...new Set(shots.slice(runStartIndex, i + 1).map((s) => s.claim_id))].join(", ")}) has no FOOTAGE_ASSIGNMENTS entry to break it up -- ` +
          "add an authored footage assignment inside this window, or acquire an additional licensed clip if the pool has none left to assign."
      );
      runSeconds = 0;
      runStartIndex = i + 1;
    }
  }

  // A pause must land on footage (the picture holds still and breathes;
  // scripts/orvyq_edit_plan_tests.mjs requires every emphasis_card shot to
  // be asset_type "footage") -- report any pause that doesn't, rather than
  // auto-converting it.
  for (const shot of shots) {
    if (shot.emphasis_card && shot.asset_type !== "footage") {
      missingCoverage.push(
        `Editorial pause "${shot.emphasis_card.title}" (claim ${shot.claim_id}) lands on a ${shot.asset_type} shot, not footage -- ` +
          "add a FOOTAGE_ASSIGNMENTS entry for this claim occurrence so the pause holds on real footage instead of an evidence/graphic card."
      );
    }
  }

  if (missingCoverage.length) {
    throw new Error(`Full production plan has ${missingCoverage.length} unresolved creative-coverage gap(s):\n- ${missingCoverage.join("\n- ")}`);
  }

  quantizeShotsToFrames(shots);

  // ---- opening motion hook: the same real, licensed footage proof mode
  // uses (direction/motion_hook.json), not a second, full-mode-only asset.
  // auditMotionHook (scripts/lib/orvyq-motion-hook.mjs) runs unconditionally
  // against BOTH modes' shots and requires a contiguous 10-14s hook_footage
  // block starting at frame 0 -- this is genuinely shared opening footage,
  // not proof-specific hardcoding, so full mode reuses it exactly as
  // authored rather than fabricating a separate hook.
  const firstSectionId = sections[0]?.section_id;
  const hookShots = (motionHook.shots || []).map((hookShot) => ({
    duration: hookShot.duration,
    claim_id: hookShot.claim_id,
    section_id: firstSectionId,
    // Derived from the clip the hook shot actually plays. A fixed scene id
    // here would mislabel every hook shot after the first and would make any
    // scene-identity accounting -- most importantly the per-source use budget
    // in orvyq-footage-use-budget.mjs -- charge the whole hook to one scene.
    scene_id: sceneIdFromAsset(hookShot.video_asset),
    visual_role: hookShot.visual_role,
    editorial_purpose: hookShot.editorial_purpose,
    narration_anchor: hookShot.narration_anchor || "Opening visual premise before the first narrated sentence.",
    semantic_rationale:
      hookShot.semantic_rationale ||
      "Establishes the physical setting that the opening narration immediately identifies.",
    semantic_link: hookShot.semantic_link || "physical",
    source_slice_index: null,
    asset_type: "footage",
    asset: hookShot.video_asset,
    trim_in_sec: hookShot.trim_in_sec,
    trim_out_sec: hookShot.trim_out_sec,
    motion: hookShot.motion_variant,
    hook_footage: true
  }));
  const hookDuration = hookShots.reduce((sum, hookShot) => sum + hookShot.duration, 0);
  if (hookDuration < motionHook.minimum_seconds || hookDuration > motionHook.maximum_seconds)
    throw new Error(`direction/motion_hook.json's own shots sum to ${hookDuration}s, outside its declared ${motionHook.minimum_seconds}-${motionHook.maximum_seconds}s range`);

  // ---- terminal end card: a fixed hold after the narration-derived
  // timeline ends, not carved out of it (see END_CARD_SECONDS above).
  const lastShot = shots.at(-1);
  const endCardShot = {
    duration: END_CARD_SECONDS,
    claim_id: lastShot.claim_id,
    section_id: lastShot.section_id,
    scene_id: lastShot.scene_id,
    visual_role: "graphic",
    editorial_purpose: "Terminal end card: hold on the film's closing line before the picture fades to black.",
    narration_anchor: "The final narrated conclusion and its immediate closing hold.",
    semantic_rationale: "Provides a restrained editorial close after the final claim; it conveys no additional evidence.",
    semantic_link: "conceptual",
    source_slice_index: null,
    asset_type: "graphic",
    graphic: {
      type: "end_card",
      mode: "brand",
      title: END_CARD_CONTENT.title,
      subtitle: END_CARD_CONTENT.subtitle ?? null,
      template_id: "orvyq_end_sting",
      necessity: "critical_result"
    },
    transition_in: "fade"
  };

  return {
    shots: [...hookShots, ...shots, endCardShot],
    totalDuration: totalDuration + hookDuration + END_CARD_SECONDS,
    claimCount: usableClaims.length,
    pauseCount: pauses.length
  };
}

export async function writeFullProductionPlan(projectId) {
  const dir = projectDir(projectId);
  const blueprintPath = path.join(dir, "direction", "editorial_blueprint.json");
  const blueprint = await readJson(blueprintPath);
  const { shots: baselineShots, totalDuration, claimCount, pauseCount } = await buildFullProductionPlan(projectId);
  const durationSeconds = Math.round(totalDuration * 1000) / 1000;
  const [rebalancePlan, visualRequests] = await Promise.all([
    readJsonSafe(path.join(dir, "direction", "visual_rebalance_plan.json"), null),
    readJsonSafe(path.join(dir, "research", "visual_asset_requests.json"), { requests: [] }),
  ]);
  const pendingVisualRequestIds = (visualRequests.requests || [])
    .filter((request) => request.status !== "ready")
    .map((request) => request.asset_request_id);
  const rebalanceMaterialized = !rebalancePlan || rebalancePlan.status === "materialized";
  const shots = rebalanceMaterialized && pendingVisualRequestIds.length === 0
    ? materializeVisualRebalancePlan({
        shots: baselineShots,
        plan: rebalancePlan,
        assetRequests: visualRequests.requests || [],
      })
    : baselineShots;
  blueprint.full_production.status = rebalanceMaterialized && pendingVisualRequestIds.length === 0
    ? "ready"
    : "blocked_pending_visual_assets";
  blueprint.full_production.blocking_claim_ids = [];
  blueprint.full_production.blocking_visual_asset_request_ids = pendingVisualRequestIds;
  if (rebalancePlan) blueprint.full_production.visual_rebalance_plan = "direction/visual_rebalance_plan.json";
  blueprint.full_production.shots = shots;
  blueprint.full_production.generated_at = new Date().toISOString();
  blueprint.full_production.generated_total_duration_seconds = durationSeconds;
  await writeJsonAtomic(blueprintPath, blueprint);

  // Keep editorial_pause_map.json's duration_policy mirroring the same
  // real, code-derived total rather than letting it drift back into an
  // independently hand-maintained number (the 660s planning target this
  // replaced was exactly that kind of drift).
  const pauseMapPath = path.join(dir, "direction", "editorial_pause_map.json");
  const pauseMap = await readJson(pauseMapPath);
  pauseMap.duration_policy.minimum_final_duration_seconds = durationSeconds;
  await writeJsonAtomic(pauseMapPath, pauseMap);

  return { shot_count: shots.length, total_duration_seconds: totalDuration, claim_count: claimCount, pause_count: pauseCount };
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
    writeFullProductionPlan(projectId)
      .then((result) => printJson({ ok: true, ...result }))
      .catch((error) => {
        console.error(JSON.stringify({ ok: false, error: error.message }));
        process.exitCode = 1;
      });
  }
}
