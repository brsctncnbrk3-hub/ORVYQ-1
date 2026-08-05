import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyVisualMedium,
  resolveVisualBalanceThresholds,
  GRAPHIC_CARD_EVIDENCE_KINDS,
} from "./orvyq-visual-balance.mjs";

const DECISIONS = new Set([
  "keep",
  "redesign",
  "replace_primary_evidence",
  "replace_contextual_footage",
  "remove",
]);
const MEDIA = new Set(["contextual_footage", "primary_evidence", "graphic_card"]);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function clone(value) {
  return structuredClone(value);
}

function unique(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
}

function stableToken(value, fallback = "unknown") {
  const token = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return token || fallback;
}

function stableShotBaseKey(shot) {
  const claim = stableToken(shot?.claim_id, "unclaimed");
  const section = stableToken(shot?.section_id, "unsectioned");
  const sourceSlice = Number.isInteger(shot?.source_slice_index)
    ? `slice-${shot.source_slice_index}`
    : "unsliced";

  if (shot?.hook_footage === true) {
    const asset = path.basename(String(shot.asset || shot.video_asset || "hook"), path.extname(String(shot.asset || shot.video_asset || "")));
    return `hook:${claim}:${stableToken(asset, "footage")}`;
  }
  if (
    shot?.graphic?.type === "end_card" ||
    shot?.narration_anchor === "The final narrated conclusion and its immediate closing hold."
  ) {
    return `terminal:${claim}:end-card`;
  }
  if (shot?.emphasis_card) {
    return `body:${claim}:${sourceSlice}:pause-${stableToken(shot.emphasis_card.title, "editorial")}`;
  }
  return `body:${claim}:${sourceSlice}:${section}`;
}

// Stable shot identity is derived only from authored semantic structure --
// never from array position or the current asset type. Footage contracts may
// replace the medium and the source-budget pass may remove an optional hook,
// but claim/slice/pause identity remains unchanged. The occurrence suffix is
// scoped to the semantic base key, so inserting or removing an unrelated shot
// cannot renumber later targets.
export function assignStableShotKeys(shots = []) {
  const output = clone(shots);
  const occurrences = new Map();
  const seen = new Set();
  for (const shot of output) {
    const base = stableShotBaseKey(shot);
    const occurrence = (occurrences.get(base) || 0) + 1;
    occurrences.set(base, occurrence);
    const expected = `${base}:occ-${occurrence}`;
    if (shot.shot_key && shot.shot_key !== expected) {
      throw new Error(`shot_key drift: expected ${expected}, found ${shot.shot_key}`);
    }
    shot.shot_key = expected;
    if (seen.has(expected)) throw new Error(`duplicate shot_key ${expected}`);
    seen.add(expected);
  }
  return output;
}

function actionIdentity(action) {
  if (typeof action?.shot_key === "string" && action.shot_key.trim()) return `key:${action.shot_key.trim()}`;
  return `legacy-index:${action?.baseline_shot_index}`;
}

function stableKeysRequired(plan) {
  return plan?.schema_version === "1.1" || Boolean(plan?.project_id);
}

function sourceIdsForShot(shot) {
  return unique([...(shot.evidence?.source_ids || []), ...(shot.editorial_overlay?.source_ids || [])]);
}

function isSourceBackedEvidenceShot(shot) {
  if (shot.asset_type === "evidence") return sourceIdsForShot(shot).length > 0;
  return shot.asset_type === "graphic" && shot.source_derived === true && sourceIdsForShot(shot).length > 0;
}

function actionLeavesSourceBackedEvidence(shot, action) {
  if (!action) return isSourceBackedEvidenceShot(shot);
  if (action.decision === "replace_primary_evidence") return true;
  if (action.decision === "replace_contextual_footage" || action.decision === "remove") return false;
  return isSourceBackedEvidenceShot(shot);
}

// Rebalancing may reduce cards and source-derived graphics, but it may
// never erase the final source-backed visual for a claim. When a plan
// would do so, retain the shortest affected baseline evidence beat.
// This minimizes presentation time while preserving claim provenance.
function protectedClaimEvidenceIndices(shots, actions) {
  const indicesByClaim = new Map();
  shots.forEach((shot, index) => {
    if (!shot.claim_id) return;
    const indices = indicesByClaim.get(shot.claim_id) || [];
    indices.push(index);
    indicesByClaim.set(shot.claim_id, indices);
  });

  const protectedIndices = new Set();
  for (const indices of indicesByClaim.values()) {
    const baselineEvidence = indices.filter((index) => isSourceBackedEvidenceShot(shots[index]));
    if (!baselineEvidence.length) continue;
    if (indices.some((index) => actionLeavesSourceBackedEvidence(shots[index], actions.get(index)))) continue;

    const candidate = baselineEvidence
      .filter((index) => {
        const action = actions.get(index);
        return action && (action.decision === "replace_contextual_footage" || action.decision === "remove");
      })
      .sort((left, right) => Number(shots[left].duration) - Number(shots[right].duration) || left - right)[0];
    if (Number.isInteger(candidate)) protectedIndices.add(candidate);
  }
  return protectedIndices;
}

function requireReadyRequest(requests, action) {
  const request = requests.get(action.asset_request_id);
  if (!request) throw new Error(`shot ${action.baseline_shot_index} references unknown asset request ${action.asset_request_id}`);
  if (request.status !== "ready") throw new Error(`shot ${action.baseline_shot_index} asset request ${action.asset_request_id} is ${request.status}`);
}

function loadPrimaryEvidenceAssets(plan, providedAssets) {
  if (Array.isArray(providedAssets)) return providedAssets;
  if (!plan?.project_id) return [];
  const manifestPath = path.join(
    REPO_ROOT,
    "projects",
    plan.project_id,
    "research",
    "primary_evidence_manifest.json",
  );
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return Array.isArray(manifest.assets) ? manifest.assets : [];
  } catch (error) {
    throw new Error(
      `project ${plan.project_id} primary-evidence manifest could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function loadActionOverrides(plan, providedOverrides) {
  if (Array.isArray(providedOverrides)) return providedOverrides;
  if (!plan?.project_id) return [];
  const overridePath = path.join(
    REPO_ROOT,
    "projects",
    plan.project_id,
    "direction",
    "visual_rebalance_overrides.json",
  );
  if (!fs.existsSync(overridePath)) return [];
  let overrideDocument;
  try {
    overrideDocument = JSON.parse(fs.readFileSync(overridePath, "utf8"));
  } catch (error) {
    throw new Error(
      `project ${plan.project_id} visual-rebalance overrides could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (overrideDocument.project_id !== plan.project_id) {
    throw new Error(
      `visual-rebalance override project_id ${overrideDocument.project_id || "missing"} does not match ${plan.project_id}`,
    );
  }
  if (!Array.isArray(overrideDocument.action_overrides)) {
    throw new Error(`project ${plan.project_id} visual-rebalance overrides require action_overrides[]`);
  }
  return overrideDocument.action_overrides;
}

export function resolveVisualRebalancePlan(plan, providedOverrides = null) {
  if (!plan) return plan;
  const resolved = clone(plan);
  const overrides = loadActionOverrides(resolved, providedOverrides);
  if (!overrides.length) return resolved;

  const actions = new Map((resolved.actions || []).map((action) => [actionIdentity(action), action]));
  const seen = new Set();
  for (const entry of overrides) {
    const index = entry?.baseline_shot_index;
    if (!Number.isInteger(index) || index < 0) {
      throw new Error(`visual-rebalance override has invalid baseline_shot_index ${index}`);
    }
    if (stableKeysRequired(resolved) && (typeof entry?.shot_key !== "string" || !entry.shot_key.trim())) {
      throw new Error(`visual-rebalance override at authored index ${index} requires shot_key`);
    }
    const identity = actionIdentity(entry);
    if (seen.has(identity)) throw new Error(`duplicate visual-rebalance override for ${identity}`);
    seen.add(identity);
    const existing = actions.get(identity);
    if (!existing) throw new Error(`visual-rebalance override targets missing action ${identity}`);
    if (entry.expected_decision && entry.expected_decision !== existing.decision) {
      throw new Error(
        `visual-rebalance override for ${identity} expected ${entry.expected_decision}, found ${existing.decision}`,
      );
    }
    if (!entry.action || typeof entry.action !== "object") {
      throw new Error(`visual-rebalance override for ${identity} requires action`);
    }
    if (entry.action.claim_id && entry.action.claim_id !== existing.claim_id) {
      throw new Error(`visual-rebalance override for ${identity} cannot change claim_id`);
    }
    if (entry.action.shot_key && entry.action.shot_key !== existing.shot_key) {
      throw new Error(`visual-rebalance override for ${identity} cannot change shot_key`);
    }
    const replacement = {
      ...existing,
      ...entry.action,
      shot_key: existing.shot_key,
      baseline_shot_index: existing.baseline_shot_index,
      claim_id: existing.claim_id,
      duration_seconds: existing.duration_seconds,
    };
    if (!DECISIONS.has(replacement.decision)) {
      throw new Error(`visual-rebalance override for ${identity} has invalid decision ${replacement.decision}`);
    }
    if (!MEDIA.has(replacement.projected_medium)) {
      throw new Error(`visual-rebalance override for ${identity} has invalid projected_medium ${replacement.projected_medium}`);
    }
    if (replacement.decision === "remove" && replacement.replacement_strategy !== "extend_adjacent_footage") {
      throw new Error(`visual-rebalance override for ${identity} removal must extend adjacent footage`);
    }
    if (replacement.decision !== "replace_primary_evidence") {
      delete replacement.replacement_assets;
      delete replacement.asset_request_id;
    }
    if (replacement.projected_medium !== "graphic_card") {
      delete replacement.template_id;
      delete replacement.projected_full_screen_text_card;
    }
    actions.set(identity, replacement);
  }
  resolved.actions = (resolved.actions || []).map((action) => actions.get(actionIdentity(action)));
  return resolved;
}

function resolvePrimaryEvidenceAttribution(replacements, evidenceAssets, action) {
  const byId = new Map(evidenceAssets.map((asset) => [asset.evidence_asset_id, asset]));
  const manifests = replacements.map((replacement) => {
    const manifest = byId.get(replacement.evidence_asset_id);
    if (!manifest) {
      throw new Error(
        `shot ${action.baseline_shot_index} replacement ${replacement.evidence_asset_id} is missing from primary_evidence_manifest.json`,
      );
    }
    const missing = [];
    if (!Array.isArray(manifest.source_ids) || !manifest.source_ids.length) missing.push("source_ids");
    for (const field of ["source_institution", "source_title", "source_date", "source_url", "content_identity"]) {
      if (typeof manifest[field] !== "string" || !manifest[field].trim()) missing.push(field);
    }
    if (missing.length) {
      throw new Error(
        `shot ${action.baseline_shot_index} replacement ${replacement.evidence_asset_id} lacks canonical provenance fields: ${missing.join(", ")}`,
      );
    }
    return manifest;
  });

  const sourceIds = unique(manifests.flatMap((manifest) => manifest.source_ids || []));
  const sourcePairs = unique(
    manifests.map((manifest) => `${manifest.source_institution.trim()} — ${manifest.source_date.trim()}`),
  );
  const institutions = unique(manifests.map((manifest) => manifest.source_institution));
  const titles = unique(manifests.map((manifest) => manifest.caption || manifest.source_title));
  const limitations = unique(manifests.map((manifest) => manifest.limitation));

  return {
    sourceIds,
    sourceLabel: sourcePairs.join(" / "),
    eyebrow: `${institutions[0].toUpperCase()} — PRIMARY EVIDENCE`,
    title: titles.length === 1 ? titles[0] : `${titles[0]} (+${titles.length - 1} source${titles.length === 2 ? "" : "s"})`,
    limitation: limitations.join(" ") || "The source supports only the specific claim and region shown on screen.",
  };
}

function applyPrimaryEvidenceReplacement(shot, action, requests, evidenceAssets) {
  requireReadyRequest(requests, action);
  const replacements = action.replacement_assets || [];
  if (!replacements.length || replacements.some((asset) => !asset.asset_path || !asset.evidence_asset_id)) {
    throw new Error(`shot ${action.baseline_shot_index} requires materialized primary-evidence replacement_assets`);
  }
  const attribution = resolvePrimaryEvidenceAttribution(replacements, evidenceAssets, action);
  const updated = clone(shot);
  // A shot arriving here may already be a NATIVE-kind evidence card
  // (source_article/comparison/concept_map/evidence_chain/boundary, built by
  // buildEvidenceContent against a wide recap source union -- see
  // scripts/lib/orvyq-evidence-authoring.mjs) whose body carries
  // items/steps/left/right/left_detail/right_detail text baked from that
  // wider source set. Once converted to an IMAGE_KINDS "official_figure" /
  // "image_sequence" card, none of those fields render (the card shows the
  // attached image, not text items/steps) and source_ids narrows to just
  // this replacement's real image sources -- so carrying that stale body
  // text through the spread below would leave numbers (dates, counts) on
  // the shot that its own new source_ids can no longer support. Drop them
  // explicitly; only the display-preference fields below (font_px,
  // eyebrow/title fallback, template_id, necessity, limitation) are safe to
  // carry over kind changes.
  const { items: _staleItems, steps: _staleSteps, left: _staleLeft, left_detail: _staleLeftDetail, right: _staleRight, right_detail: _staleRightDetail, ...existingEvidence } = updated.evidence || {};
  updated.asset_type = "evidence";
  updated.visual_role = "evidence";
  updated.editorial_purpose = action.rationale;
  updated.semantic_rationale = action.rationale;
  updated.semantic_link = "direct_evidence";
  updated.evidence = {
    ...existingEvidence,
    kind: replacements.length > 1 ? "image_sequence" : "official_figure",
    source_ids: attribution.sourceIds,
    source_label: attribution.sourceLabel,
    font_px: existingEvidence.font_px || 32,
    eyebrow: existingEvidence.eyebrow || attribution.eyebrow,
    title: existingEvidence.title || attribution.title,
    limitation: existingEvidence.limitation || attribution.limitation,
    template_id: existingEvidence.template_id || "orvyq_official_figure",
    necessity: existingEvidence.necessity || "critical_result",
    image_assets: replacements.map((asset) => asset.asset_path),
    evidence_asset_ids: replacements.map((asset) => asset.evidence_asset_id),
    source_regions: replacements.map((asset) => asset.source_region).filter(Boolean),
  };
  delete updated.asset;
  delete updated.graphic;
  delete updated.emphasis_card;
  delete updated.editorial_overlay;
  delete updated.overlay;
  delete updated.trim_in_sec;
  delete updated.trim_out_sec;
  delete updated.contextual_footage;
  delete updated.generic_stock;
  delete updated.reuse_reason;
  return updated;
}

function applyFootageReplacement(shot, action, requests) {
  requireReadyRequest(requests, action);
  const [replacement] = action.replacement_assets || [];
  if (!replacement?.asset_path || !Number.isFinite(replacement.trim_in_sec) || !Number.isFinite(replacement.trim_out_sec)) {
    throw new Error(`shot ${action.baseline_shot_index} requires a materialized footage replacement with trim bounds`);
  }
  const trimIn = Number(replacement.trim_in_sec);
  const trimOutLimit = Number(replacement.trim_out_sec);
  const shotDuration = Number(shot.duration);
  if (trimOutLimit - trimIn + 0.001 < shotDuration) {
    throw new Error(`shot ${action.baseline_shot_index} footage replacement is shorter than the shot`);
  }
  const updated = clone(shot);
  updated.asset_type = "footage";
  updated.asset = replacement.asset_path;
  updated.trim_in_sec = trimIn;
  updated.trim_out_sec = Number((trimIn + shotDuration).toFixed(6));
  updated.visual_role = "context";
  updated.editorial_purpose = action.rationale;
  updated.semantic_rationale = action.rationale;
  updated.semantic_link = "physical";
  updated.contextual_footage = true;
  updated.generic_stock = false;
  delete updated.graphic;
  delete updated.evidence;
  delete updated.emphasis_card;
  delete updated.editorial_overlay;
  delete updated.overlay;
  return updated;
}

function applyRedesign(shot, action) {
  const updated = clone(shot);
  updated.editorial_purpose = action.rationale;
  updated.semantic_rationale = action.rationale;
  if (updated.graphic) {
    updated.graphic.template_id = action.template_id;
    updated.graphic.design_system = "orvyq_cinematic_v1";
  } else if (
    updated.asset_type === "evidence" &&
    GRAPHIC_CARD_EVIDENCE_KINDS.has(updated.evidence?.kind)
  ) {
    updated.evidence.template_id = action.template_id;
    updated.evidence.design_system = "orvyq_cinematic_v1";
  } else {
    const overlay = updated.emphasis_card || updated.editorial_overlay || updated.overlay;
    if (!overlay) throw new Error(`shot ${action.baseline_shot_index} redesign has no graphic, source-derived card, or dominant overlay`);
    overlay.template_id = action.template_id;
    overlay.design_system = "orvyq_cinematic_v1";
  }
  return updated;
}

function extendAdjacentFootage(shots, index, action) {
  const previous = shots[index - 1];
  const updated = clone(shots[index]);
  let adjacent = previous;

  if (previous?.asset_type === "footage" && previous.asset) {
    updated.trim_in_sec = Number(previous.trim_out_sec);
    updated.trim_out_sec = Number(previous.trim_out_sec) + Number(updated.duration);
  } else {
    const next = shots[index + 1];
    if (!next || next.asset_type !== "footage" || !next.asset || next.claim_id !== updated.claim_id) {
      throw new Error(`shot ${action.baseline_shot_index} cannot extend adjacent same-claim footage`);
    }
    adjacent = next;
    const nextTrimIn = Number(next.trim_in_sec);
    const nextDuration = Number(next.duration);
    if (!Number.isFinite(nextTrimIn) || !Number.isFinite(nextDuration)) {
      throw new Error(`shot ${action.baseline_shot_index} has invalid successor footage trim bounds`);
    }
    const extensionStart = Math.max(0, nextTrimIn - Number(updated.duration));
    const extensionEnd = extensionStart + Number(updated.duration);
    updated.trim_in_sec = extensionStart;
    updated.trim_out_sec = extensionEnd;
    shots[index + 1] = {
      ...clone(next),
      trim_in_sec: extensionEnd,
      trim_out_sec: extensionEnd + nextDuration,
    };
  }

  updated.asset_type = "footage";
  updated.asset = adjacent.asset;
  updated.visual_role = adjacent.visual_role || "context";
  updated.editorial_purpose = action.rationale;
  updated.semantic_rationale = action.rationale;
  updated.semantic_link = adjacent.semantic_link || "conceptual";
  updated.motion = adjacent.motion || updated.motion || "hold";
  updated.contextual_footage = true;
  updated.generic_stock = Boolean(adjacent.generic_stock);
  if (adjacent.reuse_reason) updated.reuse_reason = adjacent.reuse_reason;
  else delete updated.reuse_reason;
  delete updated.graphic;
  delete updated.evidence;
  delete updated.emphasis_card;
  delete updated.editorial_overlay;
  delete updated.overlay;
  return updated;
}

// Materialization and audit deliberately share this resolver. A production
// plan (schema 1.1/project-bound) may only address shots by shot_key; the
// authored numeric index is retained for diagnostics and migration history,
// never used to choose the target. Minimal legacy unit fixtures without a
// project/schema may still use their local array index.
export function resolveVisualRebalanceTargets({ shots, plan, actionOverrides = null }) {
  const effectivePlan = resolveVisualRebalancePlan(plan, actionOverrides);
  const keyedShots = assignStableShotKeys(shots || []);
  const shotIndexByKey = new Map(keyedShots.map((shot, index) => [shot.shot_key, index]));
  const actionsByIndex = new Map();
  const actionIndexByKey = new Map();
  const failures = [];
  const requireStable = stableKeysRequired(effectivePlan);

  for (const action of effectivePlan?.actions || []) {
    let index = null;
    if (typeof action.shot_key === "string" && action.shot_key.trim()) {
      index = shotIndexByKey.get(action.shot_key.trim());
      if (!Number.isInteger(index)) {
        failures.push(`unresolved visual-rebalance shot_key ${action.shot_key}`);
        continue;
      }
    } else if (requireStable) {
      failures.push(`action at authored index ${action.baseline_shot_index} requires shot_key`);
      continue;
    } else if (Number.isInteger(action.baseline_shot_index) && action.baseline_shot_index >= 0) {
      index = action.baseline_shot_index;
    } else {
      failures.push(`invalid baseline_shot_index ${action.baseline_shot_index}`);
      continue;
    }

    if (!keyedShots[index]) {
      failures.push(`action targets missing shot at authored index ${action.baseline_shot_index}`);
      continue;
    }
    if (actionsByIndex.has(index)) {
      failures.push(`multiple visual-rebalance actions resolve to shot_key ${keyedShots[index].shot_key}`);
      continue;
    }
    actionsByIndex.set(index, action);
    actionIndexByKey.set(action.shot_key || `legacy-index:${action.baseline_shot_index}`, index);
  }

  return { effectivePlan, shots: keyedShots, actionsByIndex, actionIndexByKey, failures };
}

export function materializeVisualRebalancePlan({
  shots,
  plan,
  assetRequests = [],
  primaryEvidenceAssets = null,
  actionOverrides = null,
}) {
  const resolvedTargets = resolveVisualRebalanceTargets({ shots, plan, actionOverrides });
  const { effectivePlan, actionsByIndex: actions } = resolvedTargets;
  if (resolvedTargets.failures.length) throw new Error(resolvedTargets.failures.join("; "));
  if (!effectivePlan || effectivePlan.status !== "materialized") return resolvedTargets.shots;
  const requests = new Map(assetRequests.map((request) => [request.asset_request_id, request]));
  const needsPrimaryEvidence = [...actions.values()].some((action) => action.decision === "replace_primary_evidence");
  const evidenceAssets = needsPrimaryEvidence
    ? loadPrimaryEvidenceAssets(effectivePlan, primaryEvidenceAssets)
    : [];
  const output = resolvedTargets.shots;
  const protectedEvidenceIndices = protectedClaimEvidenceIndices(output, actions);

  for (let index = 0; index < output.length; index += 1) {
    const action = actions.get(index);
    if (!action) continue;
    if (action.claim_id !== output[index].claim_id) {
      throw new Error(`shot ${index} claim drift blocks rebalance materialization`);
    }
    if (protectedEvidenceIndices.has(index)) continue;
    if (action.decision === "redesign" || action.decision === "keep") {
      output[index] = applyRedesign(output[index], action);
    } else if (action.decision === "replace_primary_evidence") {
      output[index] = applyPrimaryEvidenceReplacement(output[index], action, requests, evidenceAssets);
    } else if (action.decision === "replace_contextual_footage") {
      output[index] = applyFootageReplacement(output[index], action, requests);
    } else if (action.decision === "remove" && action.replacement_strategy === "extend_adjacent_footage") {
      output[index] = extendAdjacentFootage(output, index, action);
    } else {
      throw new Error(`shot ${index} has unsupported materialization decision ${action.decision}`);
    }
  }
  return output;
}

function shotFrames(shot) {
  if (Number.isFinite(shot.start_frame) && Number.isFinite(shot.end_frame)) {
    return shot.end_frame - shot.start_frame;
  }
  return Math.round(Number(shot.duration) * 30);
}

export function auditVisualRebalancePlan({
  shots,
  plan,
  assetRequests = [],
  actionOverrides = null,
}, rules = {}) {
  let resolvedTargets;
  try {
    resolvedTargets = resolveVisualRebalanceTargets({ shots, plan, actionOverrides });
  } catch (error) {
    resolvedTargets = {
      effectivePlan: plan,
      shots: clone(shots || []),
      actionsByIndex: new Map(),
      actionIndexByKey: new Map(),
      failures: [error instanceof Error ? error.message : String(error)],
    };
  }
  const { effectivePlan, actionsByIndex: actions } = resolvedTargets;
  const auditedShots = resolvedTargets.shots;
  const failures = [...resolvedTargets.failures];
  const blockers = [];
  const thresholds = resolveVisualBalanceThresholds(rules);
  const requests = new Map(assetRequests.map((request) => [request.asset_request_id, request]));

  for (const action of effectivePlan?.actions || []) {
    if (!Number.isInteger(action.baseline_shot_index) || action.baseline_shot_index < 0) {
      failures.push(`invalid baseline_shot_index ${action.baseline_shot_index}`);
    }
    if (stableKeysRequired(effectivePlan) && (typeof action.shot_key !== "string" || !action.shot_key.trim()))
      failures.push(`action at authored index ${action.baseline_shot_index} requires shot_key`);
    if (!DECISIONS.has(action.decision)) failures.push(`shot ${action.baseline_shot_index} has invalid decision ${action.decision}`);
    if (!MEDIA.has(action.projected_medium)) failures.push(`shot ${action.baseline_shot_index} has invalid projected_medium ${action.projected_medium}`);
  }

  const frames = {
    contextual_footage: 0,
    primary_evidence: 0,
    graphic_card: 0,
    full_screen_text_card: 0,
  };
  const sections = new Map();
  const templates = new Map();
  let currentCardRun = 0;
  let maximumCardRun = 0;

  auditedShots.forEach((shot, index) => {
    const baselineMedium = classifyVisualMedium(shot);
    const action = actions.get(index);
    if (baselineMedium === "graphic_card" && !action) {
      failures.push(`graphic/card baseline shot ${index} has no explicit editorial decision`);
    }
    if (action) {
      if (action.claim_id !== shot.claim_id) failures.push(`shot ${index} claim drift: plan=${action.claim_id}, blueprint=${shot.claim_id}`);
      if (Math.abs(Number(action.duration_seconds) - shotFrames(shot) / 30) > 0.001) {
        failures.push(`shot ${index} duration drift`);
      }
      if (effectivePlan?.status === "materialized") {
        if (baselineMedium !== action.projected_medium) {
          failures.push(`shot ${index} materialized as ${baselineMedium}, expected ${action.projected_medium}`);
        }
      } else if (baselineMedium !== "graphic_card") {
        failures.push(`shot ${index} action targets ${baselineMedium}, not a graphic/card`);
      }
      if (["replace_primary_evidence", "replace_contextual_footage"].includes(action.decision) && !action.asset_request_id) {
        failures.push(`shot ${index} ${action.decision} requires asset_request_id`);
      }
      if (action.decision === "remove" && action.replacement_strategy !== "extend_adjacent_footage") {
        failures.push(`shot ${index} removal must preserve timeline through extend_adjacent_footage`);
      }
      if (action.asset_request_id) {
        const request = requests.get(action.asset_request_id);
        if (!request) {
          failures.push(`shot ${index} references unknown asset request ${action.asset_request_id}`);
        } else if (request.status !== "ready") {
          blockers.push(`${action.asset_request_id}: ${request.status}`);
        }
      }
      if (
        effectivePlan?.status === "materialized" &&
        ["replace_primary_evidence", "replace_contextual_footage"].includes(action.decision) &&
        !(action.replacement_assets || []).length
      ) {
        failures.push(`shot ${index} materialized replacement has no replacement_assets`);
      }
    }

    const projectedMedium = action?.projected_medium || baselineMedium;
    const frameCount = shotFrames(shot);
    if (!MEDIA.has(projectedMedium)) {
      failures.push(`shot ${index} has no exclusive projected medium`);
      return;
    }
    frames[projectedMedium] += frameCount;
    if (action?.projected_full_screen_text_card === true) {
      if (projectedMedium !== "graphic_card") failures.push(`shot ${index} marks a non-card as full-screen text`);
      frames.full_screen_text_card += frameCount;
    }
    if (projectedMedium === "graphic_card") {
      if (!action?.template_id) failures.push(`projected card shot ${index} requires template_id`);
      else templates.set(action.template_id, (templates.get(action.template_id) || 0) + 1);
    }

    const section = shot.section_id || "unsectioned";
    const sectionFrames = sections.get(section) || { total: 0, cards: 0 };
    sectionFrames.total += frameCount;
    if (projectedMedium === "graphic_card") sectionFrames.cards += frameCount;
    sections.set(section, sectionFrames);

    if (projectedMedium === "graphic_card") {
      currentCardRun += 1;
      maximumCardRun = Math.max(maximumCardRun, currentCardRun);
    } else {
      currentCardRun = 0;
    }
  });

  const durationFrames = auditedShots.reduce((sum, shot) => sum + shotFrames(shot), 0);
  const fraction = (value) => value / Math.max(1, durationFrames);
  const fractions = {
    contextual_footage: fraction(frames.contextual_footage),
    primary_evidence: fraction(frames.primary_evidence),
    graphic_card: fraction(frames.graphic_card),
    full_screen_text_card: fraction(frames.full_screen_text_card),
  };
  const pct = (value) => `${(value * 100).toFixed(2)}%`;

  if (fractions.contextual_footage < thresholds.contextual_footage_fraction_min) {
    failures.push(`projected contextual footage ${pct(fractions.contextual_footage)} is below ${pct(thresholds.contextual_footage_fraction_min)}`);
  }
  if (fractions.contextual_footage > thresholds.contextual_footage_fraction_max) {
    failures.push(`projected contextual footage ${pct(fractions.contextual_footage)} exceeds ${pct(thresholds.contextual_footage_fraction_max)}`);
  }
  if (fractions.primary_evidence < thresholds.primary_evidence_fraction_min) {
    failures.push(`projected primary evidence ${pct(fractions.primary_evidence)} is below ${pct(thresholds.primary_evidence_fraction_min)}`);
  }
  if (fractions.graphic_card > thresholds.graphic_card_fraction_max) {
    failures.push(`projected graphics/cards ${pct(fractions.graphic_card)} exceeds ${pct(thresholds.graphic_card_fraction_max)}`);
  }
  if (fractions.full_screen_text_card > thresholds.full_screen_text_card_fraction_max) {
    failures.push(`projected full-screen text ${pct(fractions.full_screen_text_card)} exceeds ${pct(thresholds.full_screen_text_card_fraction_max)}`);
  }
  if (maximumCardRun > thresholds.maximum_consecutive_graphic_card_shots) {
    failures.push(`projected card run reaches ${maximumCardRun} shots`);
  }
  for (const [section, sectionFrames] of sections) {
    const cardFraction = sectionFrames.cards / Math.max(1, sectionFrames.total);
    if (cardFraction > thresholds.section_graphic_card_fraction_max) {
      failures.push(`projected ${section} card fraction ${pct(cardFraction)} exceeds ${pct(thresholds.section_graphic_card_fraction_max)}`);
    }
  }
  for (const [template, count] of templates) {
    if (count > thresholds.maximum_graphic_template_uses) {
      failures.push(`projected template ${template} is used ${count} times; maximum ${thresholds.maximum_graphic_template_uses}`);
    }
  }

  return {
    pass: failures.length === 0 && blockers.length === 0,
    editorial_plan_pass: failures.length === 0,
    materialization_ready: blockers.length === 0,
    failures,
    blockers: [...new Set(blockers)].sort(),
    thresholds,
    duration_frames: durationFrames,
    projected_frames: frames,
    projected_seconds: Object.fromEntries(Object.entries(frames).map(([key, value]) => [key, value / 30])),
    projected_fractions: fractions,
    maximum_consecutive_graphic_card_shots: maximumCardRun,
    graphic_template_uses: Object.fromEntries(templates),
    resolved_action_targets: Object.fromEntries(resolvedTargets.actionIndexByKey),
    section_graphic_card_fractions: Object.fromEntries(
      [...sections].map(([section, value]) => [section, value.cards / Math.max(1, value.total)]),
    ),
  };
}
