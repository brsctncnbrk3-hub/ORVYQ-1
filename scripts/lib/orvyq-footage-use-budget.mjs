const CONTIGUOUS_TRIM_TOLERANCE_SECONDS = 0.02;

function clone(value) {
  return structuredClone(value);
}

function footageAsset(shot) {
  return shot?.asset_type === "footage" ? shot.asset || shot.video_asset || null : null;
}

function trimIn(shot) {
  return Number(shot?.trim_in_sec ?? shot?.trimInSec);
}

function trimOut(shot) {
  return Number(shot?.trim_out_sec ?? shot?.trimOutSec);
}

function durationSeconds(shot) {
  const direct = Number(shot?.duration);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const start = Number(shot?.start_frame);
  const end = Number(shot?.end_frame);
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) return (end - start) / 30;
  return 0;
}

function continues(previous, current) {
  const previousAsset = footageAsset(previous);
  const currentAsset = footageAsset(current);
  if (!previousAsset || previousAsset !== currentAsset) return false;
  const previousOut = trimOut(previous);
  const currentIn = trimIn(current);
  return Number.isFinite(previousOut) && Number.isFinite(currentIn) && Math.abs(previousOut - currentIn) < CONTIGUOUS_TRIM_TOLERANCE_SECONDS;
}

export function collectIndependentFootageUses(shots = []) {
  const uses = [];
  let active = null;

  const closeActive = () => {
    if (!active) return;
    uses.push(active);
    active = null;
  };

  for (let index = 0; index < shots.length; index += 1) {
    const shot = shots[index];
    const asset = footageAsset(shot);
    if (!asset) {
      closeActive();
      continue;
    }

    if (!active || !continues(shots[index - 1], shot)) {
      closeActive();
      active = {
        asset,
        start_index: index,
        end_index: index,
        duration_seconds: durationSeconds(shot),
        all_hook_footage: shot.hook_footage === true,
        all_generic_stock: shot.generic_stock === true,
        all_metaphor: shot.visual_role === "metaphor",
      };
      continue;
    }

    active.end_index = index;
    active.duration_seconds += durationSeconds(shot);
    active.all_hook_footage &&= shot.hook_footage === true;
    active.all_generic_stock &&= shot.generic_stock === true;
    active.all_metaphor &&= shot.visual_role === "metaphor";
  }
  closeActive();
  return uses;
}

export function footageUseCounts(shots = []) {
  const counts = new Map();
  for (const use of collectIndependentFootageUses(shots)) {
    counts.set(use.asset, (counts.get(use.asset) || 0) + 1);
  }
  return counts;
}

function hookDurationSeconds(shots) {
  return shots
    .filter((shot) => shot?.asset_type === "footage" && shot.hook_footage === true)
    .reduce((sum, shot) => sum + durationSeconds(shot), 0);
}

function candidateOrder(a, b) {
  if (a.all_generic_stock !== b.all_generic_stock) return a.all_generic_stock ? -1 : 1;
  if (a.all_metaphor !== b.all_metaphor) return a.all_metaphor ? -1 : 1;
  return b.start_index - a.start_index;
}

export function enforceFootageUseBudget({
  shots = [],
  maxUsesPerSource,
  minimumHookSeconds,
}) {
  const limit = Number(maxUsesPerSource);
  const minimumHook = Number(minimumHookSeconds);
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`maxUsesPerSource must be a positive integer, got ${maxUsesPerSource}`);
  if (!Number.isFinite(minimumHook) || minimumHook < 0) throw new Error(`minimumHookSeconds must be a non-negative number, got ${minimumHookSeconds}`);

  let output = clone(shots);
  const removedHookUses = [];

  while (true) {
    const uses = collectIndependentFootageUses(output);
    const counts = new Map();
    for (const use of uses) counts.set(use.asset, (counts.get(use.asset) || 0) + 1);
    const overusedAssets = [...counts.entries()].filter(([, count]) => count > limit).map(([asset]) => asset).sort();
    if (!overusedAssets.length) {
      return {
        shots: output,
        removed_hook_uses: removedHookUses,
        use_counts: Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b))),
      };
    }

    const currentHookDuration = hookDurationSeconds(output);
    const candidates = uses
      .filter((use) => overusedAssets.includes(use.asset) && use.all_hook_footage)
      .filter((use) => currentHookDuration - use.duration_seconds >= minimumHook - 0.001)
      .sort(candidateOrder);

    const selected = candidates[0];
    if (!selected) {
      const details = overusedAssets.map((asset) => `${asset}=${counts.get(asset)}`).join(", ");
      throw new Error(
        `Footage use budget cannot be satisfied without changing claim-bound body footage or dropping the hook below ${minimumHook}s: ${details}`
      );
    }

    removedHookUses.push({
      asset: selected.asset,
      start_index: selected.start_index,
      end_index: selected.end_index,
      duration_seconds: Number(selected.duration_seconds.toFixed(6)),
      reason: `Optional hook use removed because the asset exceeded the ${limit}-use source budget after claim-bound body assignments were materialized.`,
    });
    output = output.filter((_, index) => index < selected.start_index || index > selected.end_index);
  }
}
