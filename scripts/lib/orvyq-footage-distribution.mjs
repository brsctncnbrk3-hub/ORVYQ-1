// Project-independent authoring of the claim-bound contextual-footage
// distribution.
//
// The canonical source of truth for which approved clip plays at which
// narration target is `research/footage_use_contracts.json`. Everything else
// -- `config/editorial_asset_plan.json`, the blueprint shot list, the edit
// plan -- is derived from it by `orvyq_apply_footage_use_contracts.mjs`.
// Authoring a distribution directly into one of those derived files makes the
// contract and the plan disagree, and the contract reconciler then correctly
// refuses to silently drop the unaccounted assignments.
//
// So this module authors the *contract*. It reads the live claim/slice
// topology from the project's own blueprint rather than any baked-in table,
// which keeps a distribution reproducible for any project and keeps it honest
// when the shot list changes underneath it.

const TRIM_LADDER = Object.freeze([0.08, 0.32, 0.05, 0.24, 0.14]);
const MOTION_LADDER = Object.freeze(["hold", "push", "pull", "drift_left"]);

function round3(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function assertPositive(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} must be a positive number, got ${value}`);
  return parsed;
}

/**
 * Collapses a blueprint shot list into the per-claim source-slice topology the
 * distribution is authored against. A "slice" is one contracted narration
 * target; several shots may share it, so their durations are summed.
 */
export function collectClaimSliceTopology(shots = []) {
  const byClaim = new Map();
  for (const shot of shots) {
    const sliceIndex = shot?.source_slice_index;
    if (!Number.isInteger(sliceIndex)) continue;
    const claimId = String(shot?.claim_id || "").trim();
    if (!claimId) continue;
    const slices = byClaim.get(claimId) || new Map();
    slices.set(sliceIndex, (slices.get(sliceIndex) || 0) + Number(shot?.duration || 0));
    byClaim.set(claimId, slices);
  }
  return [...byClaim.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([claimId, slices]) => ({
      claim_id: claimId,
      slices: [...slices.entries()]
        .sort(([a], [b]) => a - b)
        .map(([sliceIndex, duration]) => ({ slice_index: sliceIndex, duration_seconds: round3(duration) })),
    }));
}

/**
 * Total seconds of contextual footage that already exists outside the
 * contracted body targets (the motion hook), plus how many independent uses
 * each of those scenes has already spent against the per-source budget.
 */
export function collectHookFootageUsage(shots = []) {
  const usesByScene = new Map();
  let seconds = 0;
  for (const shot of shots) {
    if (shot?.asset_type !== "footage" || shot?.hook_footage !== true) continue;
    seconds += Number(shot?.duration || 0);
    const sceneId = String(shot?.scene_id || "").trim();
    if (sceneId) usesByScene.set(sceneId, (usesByScene.get(sceneId) || 0) + 1);
  }
  return { seconds: round3(seconds), usesByScene };
}

function claimCapacity({ pool, sliceCount, maxUsesPerSource, hookUsesByScene }) {
  const spentOnHook = pool.reduce((sum, entry) => sum + (hookUsesByScene.get(entry.scene_id) || 0), 0);
  const poolCapacity = pool.length * maxUsesPerSource - spentOnHook;
  return Math.max(0, Math.min(poolCapacity, sliceCount));
}

/**
 * The most contextual-footage seconds a claim can carry without exceeding the
 * per-source use budget: its longest `capacity` slices.
 */
function bestSecondsForCapacity(slices, capacity) {
  return slices
    .map((slice) => slice.duration_seconds)
    .sort((a, b) => b - a)
    .slice(0, capacity)
    .reduce((sum, duration) => sum + duration, 0);
}

/**
 * Per-claim advice for an infeasible distribution: how many further approved
 * claim-bound scenes each claim would have to gain, and what that would buy.
 * Reported greedily by marginal gain so the smallest honest acquisition that
 * clears the floor is the one surfaced.
 */
function planCoverageShortfall({ claims, requiredSeconds, achievableSeconds, maxUsesPerSource, hookUsesByScene }) {
  const extraByClaim = new Map();
  let projected = achievableSeconds;

  const capacityWith = (claim, extraScenes) => Math.max(0, Math.min(
    (claim.pool.length + extraScenes) * maxUsesPerSource
      - claim.pool.reduce((sum, entry) => sum + (hookUsesByScene.get(entry.scene_id) || 0), 0),
    claim.slices.length,
  ));

  while (projected < requiredSeconds) {
    let best = null;
    for (const claim of claims) {
      const extra = extraByClaim.get(claim.claim_id) || 0;
      const gain = bestSecondsForCapacity(claim.slices, capacityWith(claim, extra + 1))
        - bestSecondsForCapacity(claim.slices, capacityWith(claim, extra));
      if (gain > 0 && (!best || gain > best.gain)) best = { claim_id: claim.claim_id, gain };
    }
    if (!best) break;
    extraByClaim.set(best.claim_id, (extraByClaim.get(best.claim_id) || 0) + 1);
    projected += best.gain;
  }

  return {
    required_additional_scenes: [...extraByClaim.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([claimId, count]) => ({ claim_id: claimId, additional_approved_scenes: count })),
    projected_seconds_after_acquisition: round3(projected),
    satisfiable: projected >= requiredSeconds,
  };
}

/** Distance from `candidate` to the nearest already-selected slice index. */
function spreadDistance(candidate, selected) {
  if (!selected.length) return Number.POSITIVE_INFINITY;
  return Math.min(...selected.map((index) => Math.abs(index - candidate)));
}

/**
 * Authors the claim-bound contextual-footage distribution.
 *
 * Slices are chosen to spread footage evenly through each claim (so footage
 * interleaves with primary evidence instead of clumping), bounded by the
 * per-source use budget, and sized to land the contextual-footage fraction
 * inside the profile's [min, max] band.
 */
export function planFootageDistribution({
  claimSlices,
  claimPools,
  totalRuntimeSeconds,
  hookFootageSeconds = 0,
  hookUsesByScene = new Map(),
  maxUsesPerSource,
  footageFractionMin,
  footageFractionMax,
  // A project waiting on acquisition still needs a coherent contract: the
  // reconciler that derives the editorial plan runs before acquisition does,
  // and it cannot reconcile against a contract that was never written. Set
  // this to author the best reachable distribution instead of refusing, and
  // let the caller keep failing the validation gate.
  allowBelowFloor = false,
}) {
  const runtime = assertPositive(totalRuntimeSeconds, "totalRuntimeSeconds");
  const limit = Number(maxUsesPerSource);
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`maxUsesPerSource must be a positive integer, got ${maxUsesPerSource}`);
  const fractionMin = Number(footageFractionMin);
  const fractionMax = Number(footageFractionMax);
  if (!(fractionMin > 0 && fractionMax > 0 && fractionMin <= fractionMax && fractionMax <= 1)) {
    throw new Error(`Invalid contextual footage band [${footageFractionMin}, ${footageFractionMax}]`);
  }

  const hookSeconds = Number(hookFootageSeconds) || 0;
  const hookUses = hookUsesByScene instanceof Map ? hookUsesByScene : new Map(Object.entries(hookUsesByScene || {}));

  const claims = claimSlices
    .map((entry) => ({
      claim_id: entry.claim_id,
      slices: entry.slices,
      pool: (claimPools[entry.claim_id] || []).slice(),
    }))
    .filter((claim) => claim.pool.length > 0);

  const claimsWithoutPool = claimSlices
    .filter((entry) => !(claimPools[entry.claim_id] || []).length)
    .map((entry) => entry.claim_id);

  const minBodySeconds = runtime * fractionMin - hookSeconds;
  const maxBodySeconds = runtime * fractionMax - hookSeconds;
  const targetBodySeconds = (runtime * (fractionMin + fractionMax)) / 2 - hookSeconds;

  const capacityByClaim = new Map(
    claims.map((claim) => [
      claim.claim_id,
      claimCapacity({ pool: claim.pool, sliceCount: claim.slices.length, maxUsesPerSource: limit, hookUsesByScene: hookUses }),
    ]),
  );
  const achievableSeconds = claims.reduce(
    (sum, claim) => sum + bestSecondsForCapacity(claim.slices, capacityByClaim.get(claim.claim_id)),
    0,
  );

  const belowFloor = achievableSeconds < minBodySeconds - 0.001;
  if (belowFloor && !allowBelowFloor) {
    const shortfall = planCoverageShortfall({
      claims,
      requiredSeconds: targetBodySeconds,
      achievableSeconds,
      maxUsesPerSource: limit,
      hookUsesByScene: hookUses,
    });
    const advice = shortfall.required_additional_scenes
      .map((entry) => `${entry.claim_id} +${entry.additional_approved_scenes}`)
      .join(", ");
    const error = new Error(
      `Approved claim-bound footage cannot reach the ${(fractionMin * 100).toFixed(0)}% contextual-footage floor: `
        + `at most ${round3(achievableSeconds + hookSeconds)}s of ${round3(runtime)}s `
        + `(${((achievableSeconds + hookSeconds) / runtime * 100).toFixed(1)}%) is reachable within the `
        + `${limit}-use-per-source budget, and ${round3(minBodySeconds + hookSeconds)}s is required. `
        + `Acquire and review more claim-bound footage for: ${advice || "(no claim can absorb more footage)"}.`,
    );
    error.code = "FOOTAGE_COVERAGE_INFEASIBLE";
    error.details = {
      reachable_seconds: round3(achievableSeconds + hookSeconds),
      reachable_fraction: round3((achievableSeconds + hookSeconds) / runtime),
      required_seconds: round3(minBodySeconds + hookSeconds),
      required_fraction: fractionMin,
      claims_without_approved_pool: claimsWithoutPool,
      ...shortfall,
    };
    throw error;
  }

  // Phase 1 -- spread. Round 0 anchors every claim's opening slice on approved
  // footage; later rounds add the slice furthest from what the claim already
  // carries, so footage and evidence interleave instead of clumping.
  const selectedByClaim = new Map(claims.map((claim) => [claim.claim_id, []]));
  let bodySeconds = 0;
  let round = 0;
  let progressed = true;
  while (progressed && bodySeconds < targetBodySeconds) {
    progressed = false;
    for (const claim of claims) {
      const selected = selectedByClaim.get(claim.claim_id);
      if (selected.length >= capacityByClaim.get(claim.claim_id)) continue;
      const taken = new Set(selected);
      const candidates = claim.slices.filter((slice) => !taken.has(slice.slice_index));
      if (!candidates.length) continue;

      const chosen = round === 0
        ? candidates[0]
        : candidates
          .slice()
          .sort((a, b) =>
            spreadDistance(b.slice_index, selected) - spreadDistance(a.slice_index, selected)
            || b.duration_seconds - a.duration_seconds
            || a.slice_index - b.slice_index)[0];

      if (bodySeconds + chosen.duration_seconds > maxBodySeconds + 0.001) continue;
      selected.push(chosen.slice_index);
      bodySeconds += chosen.duration_seconds;
      progressed = true;
      if (bodySeconds >= targetBodySeconds) break;
    }
    round += 1;
  }

  // Phase 2 -- floor. The spread pass optimises placement, not duration, so it
  // can stop short of the minimum even when capacity remains. Top up with the
  // longest slices still available.
  if (bodySeconds < minBodySeconds - 0.001) {
    const remaining = [];
    for (const claim of claims) {
      const taken = new Set(selectedByClaim.get(claim.claim_id));
      if (selectedByClaim.get(claim.claim_id).length >= capacityByClaim.get(claim.claim_id)) continue;
      for (const slice of claim.slices) {
        if (!taken.has(slice.slice_index)) remaining.push({ claim, slice });
      }
    }
    remaining.sort((a, b) => b.slice.duration_seconds - a.slice.duration_seconds
      || a.claim.claim_id.localeCompare(b.claim.claim_id)
      || a.slice.slice_index - b.slice.slice_index);
    for (const { claim, slice } of remaining) {
      if (bodySeconds >= minBodySeconds - 0.001) break;
      const selected = selectedByClaim.get(claim.claim_id);
      if (selected.length >= capacityByClaim.get(claim.claim_id)) continue;
      if (bodySeconds + slice.duration_seconds > maxBodySeconds + 0.001) continue;
      selected.push(slice.slice_index);
      bodySeconds += slice.duration_seconds;
    }
  }

  if (bodySeconds < minBodySeconds - 0.001 && !allowBelowFloor) {
    const error = new Error(
      `Authored contextual footage reaches ${round3(bodySeconds + hookSeconds)}s of ${round3(runtime)}s `
        + `(${((bodySeconds + hookSeconds) / runtime * 100).toFixed(1)}%); the profile floor is `
        + `${(fractionMin * 100).toFixed(0)}%. No further slice fits inside the `
        + `${(fractionMax * 100).toFixed(0)}% ceiling without exceeding the ${limit}-use-per-source budget.`,
    );
    error.code = "FOOTAGE_COVERAGE_INFEASIBLE";
    throw error;
  }

  // Bind approved scenes to the selected targets. Scenes that already spent a
  // use on the motion hook go last, so the remaining budget spreads evenly.
  const assignments = [];
  const usesByScene = new Map(hookUses);
  for (const claim of claims) {
    const selected = selectedByClaim.get(claim.claim_id).slice().sort((a, b) => a - b);
    if (!selected.length) continue;
    const pool = claim.pool
      .map((entry, index) => ({ entry, index, hookUses: hookUses.get(entry.scene_id) || 0 }))
      .sort((a, b) => a.hookUses - b.hookUses || a.index - b.index)
      .map((item) => item.entry);

    let cursor = 0;
    for (const sliceIndex of selected) {
      let scene = null;
      for (let attempt = 0; attempt < pool.length; attempt += 1) {
        const candidate = pool[(cursor + attempt) % pool.length];
        if ((usesByScene.get(candidate.scene_id) || 0) < limit) {
          scene = candidate;
          cursor = (cursor + attempt + 1) % pool.length;
          break;
        }
      }
      if (!scene) {
        throw new Error(
          `${claim.claim_id}: approved pool exhausted its ${limit}-use budget before slice ${sliceIndex} could be bound`,
        );
      }
      const useOrdinal = usesByScene.get(scene.scene_id) || 0;
      usesByScene.set(scene.scene_id, useOrdinal + 1);
      assignments.push({
        scene_id: scene.scene_id,
        claim_id: claim.claim_id,
        slice_index: sliceIndex,
        trim_in_ratio: TRIM_LADDER[useOrdinal % TRIM_LADDER.length],
        motion: MOTION_LADDER[(sliceIndex + useOrdinal) % MOTION_LADDER.length],
        role: scene.role,
        semantic_link: scene.semantic_link,
        semantic_rationale: scene.semantic_rationale,
      });
    }
  }

  assignments.sort((a, b) => a.claim_id.localeCompare(b.claim_id) || a.slice_index - b.slice_index);

  return {
    assignments,
    summary: {
      claim_count: claims.length,
      claims_without_approved_pool: claimsWithoutPool,
      assignment_count: assignments.length,
      total_runtime_seconds: round3(runtime),
      hook_footage_seconds: round3(hookSeconds),
      body_footage_seconds: round3(bodySeconds),
      contextual_footage_fraction: round3((bodySeconds + hookSeconds) / runtime),
      coverage_status: bodySeconds < minBodySeconds - 0.001 ? "below_floor_pending_acquisition" : "within_band",
      contextual_footage_fraction_min: fractionMin,
      contextual_footage_fraction_max: fractionMax,
      max_uses_per_source: limit,
      maximum_uses_reached: Math.max(0, ...[...usesByScene.values()]),
      reachable_body_seconds: round3(achievableSeconds),
    },
  };
}
