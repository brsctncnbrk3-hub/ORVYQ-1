const TRIM_TOLERANCE_SECONDS = 0.02;
export const MINIMUM_CINEMATIC_PLAYBACK_RATE = 0.75;

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

function shotDuration(shot) {
  const duration = Number(shot?.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Footage shot has invalid duration ${shot?.duration}`);
  }
  return duration;
}

function continues(previous, current) {
  const previousAsset = footageAsset(previous);
  const currentAsset = footageAsset(current);
  if (!previousAsset || previousAsset !== currentAsset) return false;
  const previousOut = trimOut(previous);
  const currentIn = trimIn(current);
  return Number.isFinite(previousOut) && Number.isFinite(currentIn) && Math.abs(previousOut - currentIn) < TRIM_TOLERANCE_SECONDS;
}

function normalizeDurationMap(sourceDurationByAsset) {
  if (sourceDurationByAsset instanceof Map) return sourceDurationByAsset;
  return new Map(Object.entries(sourceDurationByAsset || {}));
}

function round(value) {
  return Number(value.toFixed(6));
}

function setRunTiming({ output, startIndex, endIndex, start, playbackRate }) {
  let cursor = start;
  for (let runIndex = startIndex; runIndex <= endIndex; runIndex += 1) {
    const duration = shotDuration(output[runIndex]);
    output[runIndex].trim_in_sec = round(cursor);
    cursor += duration * playbackRate;
    output[runIndex].trim_out_sec = round(cursor);
    if (Math.abs(playbackRate - 1) > 0.000001) output[runIndex].playback_rate = round(playbackRate);
    else delete output[runIndex].playback_rate;
  }
  return cursor;
}

export function fitContiguousFootageRunsToSources({
  shots = [],
  sourceDurationByAsset = new Map(),
  minimumPlaybackRate = MINIMUM_CINEMATIC_PLAYBACK_RATE,
}) {
  const output = clone(shots);
  const durations = normalizeDurationMap(sourceDurationByAsset);
  const shiftedRuns = [];
  const slowedRuns = [];
  const rateFloor = Number(minimumPlaybackRate);
  if (!Number.isFinite(rateFloor) || rateFloor <= 0 || rateFloor > 1) {
    throw new Error(`minimumPlaybackRate must be in (0, 1], got ${minimumPlaybackRate}`);
  }

  let index = 0;
  while (index < output.length) {
    const asset = footageAsset(output[index]);
    if (!asset) {
      index += 1;
      continue;
    }

    const startIndex = index;
    let endIndex = index;
    while (endIndex + 1 < output.length && continues(output[endIndex], output[endIndex + 1])) {
      endIndex += 1;
    }

    const sourceDuration = Number(durations.get(asset));
    const firstTrimIn = trimIn(output[startIndex]);
    const lastTrimOut = trimOut(output[endIndex]);
    if (!Number.isFinite(firstTrimIn) || !Number.isFinite(lastTrimOut)) {
      throw new Error(`${asset} has a contiguous footage run with invalid trim bounds`);
    }

    if (Number.isFinite(sourceDuration) && sourceDuration > 0 && lastTrimOut > sourceDuration + 0.001) {
      const totalTimelineDuration = output
        .slice(startIndex, endIndex + 1)
        .reduce((sum, shot) => sum + shotDuration(shot), 0);
      const currentSourceSpan = lastTrimOut - firstTrimIn;

      if (currentSourceSpan <= sourceDuration + 0.001) {
        const shiftedStart = Math.max(0, sourceDuration - currentSourceSpan);
        const fittedEnd = setRunTiming({
          output,
          startIndex,
          endIndex,
          start: shiftedStart,
          playbackRate: currentSourceSpan / totalTimelineDuration,
        });
        shiftedRuns.push({
          asset,
          start_index: startIndex,
          end_index: endIndex,
          original_trim_in_sec: firstTrimIn,
          original_trim_out_sec: lastTrimOut,
          fitted_trim_in_sec: round(shiftedStart),
          fitted_trim_out_sec: round(fittedEnd),
          source_duration_seconds: sourceDuration,
          reason: "The contiguous approved-footage run was shifted earlier inside the same source because a downstream extension exhausted the source tail.",
        });
      } else {
        const requiredPlaybackRate = sourceDuration / totalTimelineDuration;
        if (requiredPlaybackRate < rateFloor - 0.000001) {
          throw new Error(
            `${asset} cannot fit contiguous footage run ${startIndex}-${endIndex}: ` +
              `${totalTimelineDuration.toFixed(3)}s timeline requires playback_rate=${requiredPlaybackRate.toFixed(3)}, ` +
              `below the system floor ${rateFloor.toFixed(3)} for ${sourceDuration.toFixed(3)}s of real source`,
          );
        }
        const fittedEnd = setRunTiming({
          output,
          startIndex,
          endIndex,
          start: 0,
          playbackRate: requiredPlaybackRate,
        });
        slowedRuns.push({
          asset,
          start_index: startIndex,
          end_index: endIndex,
          original_trim_in_sec: firstTrimIn,
          original_trim_out_sec: lastTrimOut,
          fitted_trim_in_sec: 0,
          fitted_trim_out_sec: round(fittedEnd),
          source_duration_seconds: sourceDuration,
          playback_rate: round(requiredPlaybackRate),
          minimum_playback_rate: rateFloor,
          reason: "The same approved source was played slightly slower to preserve the authored timeline after a downstream extension; looping and synthetic frames remain forbidden.",
        });
      }
    }

    index = endIndex + 1;
  }

  return { shots: output, shifted_runs: shiftedRuns, slowed_runs: slowedRuns };
}
