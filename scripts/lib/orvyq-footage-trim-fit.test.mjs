import test from "node:test";
import assert from "node:assert/strict";
import { fitContiguousFootageRunsToSources } from "./orvyq-footage-trim-fit.mjs";

function footage(asset, trimIn, duration) {
  return {
    asset_type: "footage",
    asset,
    duration,
    trim_in_sec: trimIn,
    trim_out_sec: trimIn + duration,
  };
}

test("valid contiguous footage runs remain byte-for-byte unchanged", () => {
  const shots = [footage("a.mp4", 2, 4), footage("a.mp4", 6, 3)];
  const result = fitContiguousFootageRunsToSources({
    shots,
    sourceDurationByAsset: new Map([["a.mp4", 12]]),
  });
  assert.deepEqual(result.shots, shots);
  assert.deepEqual(result.shifted_runs, []);
  assert.deepEqual(result.slowed_runs, []);
});

test("a downstream extension that overruns the source tail shifts the run earlier when its real span still fits", () => {
  const shots = [
    footage("a.mp4", 8, 6),
    footage("a.mp4", 14, 4),
  ];
  const result = fitContiguousFootageRunsToSources({
    shots,
    sourceDurationByAsset: new Map([["a.mp4", 14]]),
  });
  assert.equal(result.shifted_runs.length, 1);
  assert.equal(result.slowed_runs.length, 0);
  assert.equal(result.shots[0].trim_in_sec, 4);
  assert.equal(result.shots[0].trim_out_sec, 10);
  assert.equal(result.shots[1].trim_in_sec, 10);
  assert.equal(result.shots[1].trim_out_sec, 14);
  assert.equal(result.shots[0].playback_rate, undefined);
});

test("an overlong contiguous run uses one bounded playback rate instead of looping or synthetic frames", () => {
  const shots = [footage("a.mp4", 6.067, 7.9333333333), footage("a.mp4", 14, 6), footage("a.mp4", 20, 4)];
  const result = fitContiguousFootageRunsToSources({
    shots,
    sourceDurationByAsset: { "a.mp4": 14 },
  });
  assert.equal(result.slowed_runs.length, 1);
  assert.equal(result.shifted_runs.length, 0);
  assert.equal(result.shots[0].trim_in_sec, 0);
  assert.equal(result.shots.at(-1).trim_out_sec, 14);
  assert.ok(result.shots.every((shot) => shot.playback_rate >= 0.75 && shot.playback_rate < 1));
  assert.equal(result.shots[0].playback_rate, result.shots[1].playback_rate);
  assert.equal(result.shots[1].playback_rate, result.shots[2].playback_rate);
});

test("the fitter fails closed when the required slowdown falls below the cinematic floor", () => {
  const shots = [footage("a.mp4", 0, 10), footage("a.mp4", 10, 10)];
  assert.throws(
    () => fitContiguousFootageRunsToSources({
      shots,
      sourceDurationByAsset: { "a.mp4": 14 },
    }),
    /playback_rate=0\.700, below the system floor 0\.750/,
  );
});

test("separate non-contiguous uses are fitted independently", () => {
  const shots = [
    footage("a.mp4", 0, 4),
    { asset_type: "evidence", duration: 2 },
    footage("a.mp4", 12, 4),
  ];
  const result = fitContiguousFootageRunsToSources({
    shots,
    sourceDurationByAsset: { "a.mp4": 14 },
  });
  assert.equal(result.shots[0].trim_in_sec, 0);
  assert.equal(result.shots[2].trim_in_sec, 10);
  assert.equal(result.shots[2].trim_out_sec, 14);
  assert.equal(result.shifted_runs.length, 1);
  assert.equal(result.slowed_runs.length, 0);
});
