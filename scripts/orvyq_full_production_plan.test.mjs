import { test } from "node:test";
import assert from "node:assert/strict";
import {
  kindFor,
  titleCase,
  locateClaimWindow,
  sliceClaimWindow,
  quantizeShotsToFrames,
  expandFootageAssignments,
  applyEvidenceHoldToNextWindow,
  shrinkGraphicBreakSliceToMax,
  resolveEvidenceOverrideAssets,
  loadEditorialAssetPlan,
  GRAPHIC_BREAK_ASSIGNMENTS,
  SLICE_COUNT_OVERRIDES
} from "./orvyq_full_production_plan.mjs";
import { tokenizeWords } from "./lib/orvyq-pause-resolver.mjs";
import { firstReadyProjectId } from "./lib/test-ready-project.mjs";

// Mirrors buildCanonicalEditPlan's own cumulative frame assignment
// (scripts/orvyq_edit_plan.mjs) exactly: a single running float cursor,
// start/end frame read off it via Math.round(cursor * fps) at each shot
// boundary, never reset or corrected between shots.
function assignFrames(shots, fps, startCursor = 0) {
  let cursor = startCursor;
  return shots.map((shot) => {
    const start_frame = Math.round(cursor * fps);
    cursor += shot.duration;
    const end_frame = Math.round(cursor * fps);
    return { ...shot, start_frame, end_frame };
  });
}

function wordsFrom(text, secondsPerWord = 0.5) {
  return text.split(/\s+/).map((w, i) => ({ text: w, start: i * secondsPerWord, end: (i + 1) * secondsPerWord - 0.05 }));
}

test("kindFor maps known visual_treatment vocabulary and falls back to boundary for unknown values", () => {
  assert.equal(kindFor("evidence_mosaic"), "concept_map");
  assert.equal(kindFor("comparison_overlay"), "comparison");
  assert.equal(kindFor("something_never_seen"), "boundary");
});

test("titleCase strips the SEC_NN_ prefix and title-cases each word", () => {
  assert.equal(titleCase("SEC_01_RACE_PARADOX"), "Race Paradox");
  assert.equal(titleCase("SEC_09_FINAL_PARADOX"), "Final Paradox");
});

test("locateClaimWindow finds an exact contiguous quote", () => {
  const words = wordsFrom("Introductory filler words here. Not someday. Right now. Then it kept going for a good while longer past this point.");
  const tokens = tokenizeWords(words);
  const claim = { claim_id: "CLM_TEST", narration_excerpt: "Not someday. Right now." };
  const { matchStart, matchEnd, nextSearchTokenIndex } = locateClaimWindow(tokens, claim, 0);
  assert.ok(matchStart < matchEnd);
  assert.ok(nextSearchTokenIndex > 0);
});

test("locateClaimWindow falls back to bag-of-words matching for a reordered paraphrase", () => {
  const words = wordsFrom(
    "Established companies large and well funded may in practice be able to absorb the complex compliance and reporting costs more easily than smaller rivals. Then narration continues for quite a while after that point to give the scanner room."
  );
  const tokens = tokenizeWords(words);
  const claim = { claim_id: "CLM_TEST", narration_excerpt: "Compliance costs may be easier for established companies to absorb" };
  const { matchStart, matchEnd } = locateClaimWindow(tokens, claim, 0);
  assert.ok(matchStart < matchEnd);
});

test("locateClaimWindow throws when a claim cannot be located at all", () => {
  const words = wordsFrom("This narration is entirely unrelated to the claim text and shares no real words with it whatsoever.");
  const tokens = tokenizeWords(words);
  const claim = { claim_id: "CLM_TEST", narration_excerpt: "Quantum toaster hypnosis breakfast negotiation zeppelin" };
  assert.throws(() => locateClaimWindow(tokens, claim, 0), /could not be located/);
});

test("sliceClaimWindow splits a window into slices no longer than the max, with no rotation and no artificial duration variation", () => {
  const claim = { visual_treatment: { primary: "evidence_mosaic", secondary: "comparison_overlay", metaphor: "distributed_risk" } };
  const slices = sliceClaimWindow(claim, 0, 20, 8);
  assert.ok(slices.every((slice) => slice.end - slice.start <= 8 + 1e-9));
  const total = slices.reduce((sum, slice) => sum + (slice.end - slice.start), 0);
  assert.ok(Math.abs(total - 20) < 1e-9);
  // Every slice uses the claim's own primary visual_treatment -- there is no
  // evidence/context/metaphor rotation and no forced "boundary" kind.
  for (const slice of slices) assert.equal(slice.kind, "concept_map");
  // Interior slices are exactly equal (no DURATION_VARIATION_DELTA jitter),
  // up to float noise from sequential re-centering (1e-9 tolerance).
  const interior = slices.slice(0, -1);
  for (const slice of interior) assert.ok(Math.abs(slice.end - slice.start - (interior[0].end - interior[0].start)) < 1e-9);
  // Every slice's own 0-based array index is directly usable as a
  // FOOTAGE_ASSIGNMENTS[claim_id][sliceIndex] key -- there is no positional
  // restriction on which slice may carry a footage assignment (no
  // "footageCandidateSlot" field, no every-third-slice rule).
  assert.ok(!("footageCandidateSlot" in slices[0]));
});

test("sliceClaimWindow returns a single slice when the window already fits within the cap", () => {
  const claim = { visual_treatment: { primary: "evidence_mosaic", secondary: "comparison_overlay" } };
  const slices = sliceClaimWindow(claim, 10, 14, 8);
  assert.equal(slices.length, 1);
  assert.equal(slices[0].start, 10);
  assert.equal(slices[0].end, 14);
});

// Real-narration boundary snapping (the orvyq_pacing_audit.mjs pacing fix):
// without real word tokens in range, sliceClaimWindow must still fall back
// to the plain equal-fraction split -- this keeps every caller that has no
// alignment data (and the two tests above) byte-identical to before.
test("sliceClaimWindow without tokens falls back to exact equal-width slices", () => {
  const claim = { visual_treatment: { primary: "evidence_mosaic" } };
  const slices = sliceClaimWindow(claim, 0, 20, 8);
  const interior = slices.slice(0, -1);
  for (const slice of interior) assert.ok(Math.abs(slice.end - slice.start - (interior[0].end - interior[0].start)) < 1e-9);
});

// With real word tokens in range, an interior boundary snaps onto whichever
// real word-end timestamp is closest to the exact equal-fraction point --
// here a sentence end sits just after the ideal split, and the boundary
// should land exactly there instead of at the untouched fraction point.
// A 0-14s/8s-cap window makes exactly 2 slices with an ideal split at t=7;
// the search window is bounded below by max(start, 7-2.8)=4.2 and above by
// min(coverEnd, start+8, 7+2.8)=8 -- every filler word is placed below 4.2
// (outside that window) so only the sentence end under test is a candidate.
test("sliceClaimWindow snaps an interior boundary onto a nearby real sentence end", () => {
  const claim = { visual_treatment: { primary: "evidence_mosaic" } };
  const words = [
    { text: "Intro", start: 0, end: 0.6 },
    { text: "words", start: 0.8, end: 1.2 },
    { text: "leading", start: 1.4, end: 2 },
    { text: "up", start: 2.2, end: 2.6 },
    { text: "to", start: 2.8, end: 3.2 },
    { text: "the", start: 3.3, end: 3.6 },
    { text: "split", start: 3.7, end: 4 },
    { text: "here.", start: 4.5, end: 7.35 },
    { text: "More", start: 8.5, end: 9.3 },
    { text: "narration", start: 9.4, end: 10.5 },
    { text: "continues", start: 10.6, end: 11.5 },
    { text: "onward.", start: 11.6, end: 12.5 }
  ];
  const tokens = tokenizeWords(words);
  const slices = sliceClaimWindow(claim, 0, 14, 8, tokens, []);
  assert.equal(slices.length, 2);
  assert.equal(slices[0].end, 7.35);
  assert.notEqual(slices[0].end - slices[0].start, slices[1].end - slices[1].start);
});

// A boundary never moves far enough to push either neighboring slice past
// maxShotSeconds, even when a real word end sits well outside the safe
// search window: same layout as above, but the candidate word now ends
// well past t=8 (the hard maxShotSeconds-relative cap for this boundary),
// so it must be ignored and the boundary must fall back to the exact
// ideal fraction point (t=7).
test("sliceClaimWindow ignores a real word end that is too far from the ideal split to use safely", () => {
  const claim = { visual_treatment: { primary: "evidence_mosaic" } };
  const words = [
    { text: "Intro", start: 0, end: 0.6 },
    { text: "words", start: 0.8, end: 1.2 },
    { text: "leading", start: 1.4, end: 2 },
    { text: "up", start: 2.2, end: 2.6 },
    { text: "to", start: 2.8, end: 3.2 },
    { text: "the", start: 3.3, end: 3.6 },
    { text: "split", start: 3.7, end: 4 },
    { text: "here.", start: 5.1, end: 13 },
    { text: "More", start: 13.2, end: 13.4 }
  ];
  const tokens = tokenizeWords(words);
  const slices = sliceClaimWindow(claim, 0, 14, 8, tokens, []);
  assert.equal(slices[0].end, 7);
  assert.ok(slices.every((slice) => slice.end - slice.start <= 8 + 1e-9));
});

// evidenceKindOverrides -- direction/sequence_plan.json's mechanism for
// routing a claim's evidence slices to a real materialized IMAGE_KINDS
// asset instead of kindFor()'s NATIVE_KINDS-only default (the confirmed
// structural cause of the rejected review's zero real evidence assets).
test("sliceClaimWindow: an evidenceKindOverrides entry replaces kindFor()'s default for every slice of that claim", () => {
  const claim = { claim_id: "CLM_001_LABS_PUBLISH_SAFETY_FRAMEWORKS", visual_treatment: { primary: "evidence_mosaic" } };
  const overrides = { CLM_001_LABS_PUBLISH_SAFETY_FRAMEWORKS: { kind: "image_sequence", evidence_asset_ids: ["EVID_A"], image_assets: ["assets/evidence/a.png"] } };
  const slices = sliceClaimWindow(claim, 0, 20, 8, [], [], overrides);
  for (const slice of slices) assert.equal(slice.kind, "image_sequence");
});

test("sliceClaimWindow: a claim with no evidenceKindOverrides entry is unaffected (kindFor() default, matching pre-Phase-1 behavior)", () => {
  const claim = { claim_id: "CLM_999_UNRELATED", visual_treatment: { primary: "evidence_mosaic" } };
  const overrides = { CLM_001_LABS_PUBLISH_SAFETY_FRAMEWORKS: { kind: "image_sequence", evidence_asset_ids: ["EVID_A"], image_assets: ["assets/evidence/a.png"] } };
  const slices = sliceClaimWindow(claim, 0, 20, 8, [], [], overrides);
  for (const slice of slices) assert.equal(slice.kind, "concept_map");
});

// Real regression: an evidence_kind_overrides slice landed at 2.17s (a real
// narration-boundary snap), under orvyq_mobile_legibility_audit.mjs's own
// ">= 4s" floor for any IMAGE_KINDS shot -- narration-boundary placement has
// no notion of that floor on its own. A single real word token pins the free
// interior boundary at 3.2s; growImageEvidenceSliceToFloor must then widen
// slice 0 up to IMAGE_EVIDENCE_FLOOR_SECONDS (4.1s) by borrowing from its
// only neighbor, without losing or inventing any total duration.
test("sliceClaimWindow: an undersized evidenceKindOverrides IMAGE_KINDS slice is widened to the mobile-legibility floor by borrowing from its neighbor", () => {
  const claim = { claim_id: "CLM_TEST_IMAGE_FLOOR", visual_treatment: { primary: "evidence_mosaic" } };
  const overrides = { CLM_TEST_IMAGE_FLOOR: { kind: "image_sequence", evidence_asset_ids: ["EVID_A"], image_assets: ["assets/evidence/a.png"] } };
  const tokens = [{ text: "frameworks.", start: 3.0, end: 3.2 }];
  const slices = sliceClaimWindow(claim, 0, 10, 20, tokens, [], overrides);
  assert.equal(slices.length, 2);
  assert.equal(slices[0].start, 0);
  assert.equal(slices[1].end, 10);
  assert.ok(slices[0].end - slices[0].start >= 4, `slice 0 should be widened to at least 4s, got ${slices[0].end - slices[0].start}`);
  assert.ok(slices[1].end - slices[1].start >= 2, "donor slice should not be squeezed below the safe minimum");
  // Borrowing only ever moves the shared boundary -- never invents or drops time.
  const totalDuration = slices.reduce((sum, slice) => sum + (slice.end - slice.start), 0);
  assert.ok(Math.abs(totalDuration - 10) < 1e-9);
});

// When more than one slice of the same claim needs the floor, an earlier
// slice's fix can be partially undone by a later slice borrowing back from
// the same shared checkpoint (both are real neighbors of each other) --
// sliceClaimWindow must fail loudly rather than silently ship a slice that
// never actually reached the real mobile-legibility minimum.
test("sliceClaimWindow: throws when multiple adjacent undersized IMAGE_KINDS slices cannot all independently reach the floor", () => {
  const claim = { claim_id: "CLM_TEST_IMAGE_FLOOR_INFEASIBLE", visual_treatment: { primary: "evidence_mosaic" } };
  const overrides = { CLM_TEST_IMAGE_FLOOR_INFEASIBLE: { kind: "image_sequence", evidence_asset_ids: ["EVID_A"], image_assets: ["assets/evidence/a.png"] } };
  assert.throws(() => sliceClaimWindow(claim, 0, 11, 5, [], [], overrides), /CLM_TEST_IMAGE_FLOOR_INFEASIBLE.*4s real-document minimum/s);
});

// Real regression: CLM_001_LABS_PUBLISH_SAFETY_FRAMEWORKS is a genuine
// single-slice claim (its whole real narration window is one slice, both
// edges the claim's own fixed boundary) -- growImageEvidenceSliceToFloor has
// no sibling to borrow from at all. Confirmed against the real committed
// voice/narration_alignment.json + research/evidence_map.json: CLM_001's raw
// window is 4.66s, but SEC_01's own deferred title card (2.5s, taken off the
// top of the section's first claim for every section, not special-cased for
// SEC_01) shrinks it to 2.16s before slicing ever sees it -- not a mapping
// bug, a genuine budget conflict between two real, intentional constraints
// that both draw from the same claim's narration span.
test("sliceClaimWindow: a single-slice claim (no sibling to borrow from) extends its own last slice past coverEnd instead of throwing", () => {
  const claim = { claim_id: "CLM_001_LABS_PUBLISH_SAFETY_FRAMEWORKS", visual_treatment: { primary: "evidence_mosaic" } };
  const overrides = { CLM_001_LABS_PUBLISH_SAFETY_FRAMEWORKS: { kind: "image_sequence", evidence_asset_ids: ["EVID_A"], image_assets: ["assets/evidence/a.png"] } };
  const slices = sliceClaimWindow(claim, 0, 2.16, 8, [], [], overrides);
  assert.equal(slices.length, 1);
  assert.equal(slices[0].start, 0);
  assert.ok(slices[0].end > 2.16, "the last (only) slice should extend past its own coverEnd");
  assert.ok(slices[0].end - slices[0].start >= 4, `the extended slice should reach the real >=4s legibility minimum, got ${slices[0].end - slices[0].start}`);
});

// applyEvidenceHoldToNextWindow -- buildFullProductionPlan's own cross-claim
// adjustment, extracted standalone so the real narration-budget arithmetic
// (spanning two adjacent claims, no overlap/gap/drift, unchanged total
// duration, evidence attribution untouched) is directly testable.
test("applyEvidenceHoldToNextWindow: a document shot spanning two adjacent claims shrinks the next claim's window by exactly the hold, with no gap or overlap", () => {
  const claimA = { claim_id: "CLM_A", visual_treatment: { primary: "evidence_mosaic" } };
  const claimB = { claim_id: "CLM_B", visual_treatment: { primary: "evidence_mosaic" } };
  const overrides = { CLM_A: { kind: "image_sequence", evidence_asset_ids: ["EVID_A"], image_assets: ["assets/evidence/a.png"] } };
  const windows = [
    { claim: claimA, coverStart: 0, coverEnd: 2.16 },
    { claim: claimB, coverStart: 2.16, coverEnd: 20 }
  ];
  const originalTotalSpan = windows[0].coverEnd - windows[0].coverStart + (windows[1].coverEnd - windows[1].coverStart);

  const slices = sliceClaimWindow(claimA, windows[0].coverStart, windows[0].coverEnd, 8, [], [], overrides);
  const holdSeconds = applyEvidenceHoldToNextWindow(windows, 0, windows[0].coverEnd, slices);

  assert.ok(holdSeconds > 0, "a hold should have been applied");
  // No gap or overlap: the next claim's window starts EXACTLY where the
  // held shot's own end lands -- not a moment earlier (overlap, duplicated
  // real narration seconds) or later (a gap with no shot covering it).
  assert.equal(windows[1].coverStart, slices.at(-1).end);
  // Evidence attribution: the originating claim's own window is completely
  // untouched -- only the FOLLOWING claim's coverStart moved.
  assert.equal(windows[0].coverStart, 0);
  assert.equal(windows[0].coverEnd, 2.16);
  assert.equal(windows[0].claim.claim_id, "CLM_A");
  // Total candidate duration preserved: claim A's own shot got wider by
  // exactly what claim B's own window got narrower by -- nothing invented,
  // nothing dropped.
  const newTotalSpan = slices.at(-1).end - windows[0].coverStart + (windows[1].coverEnd - windows[1].coverStart);
  assert.ok(Math.abs(newTotalSpan - originalTotalSpan) < 1e-9);
});

test("applyEvidenceHoldToNextWindow: a no-op (returns 0, mutates nothing) when the slice never needed to extend past coverEnd", () => {
  const claimA = { claim_id: "CLM_A" };
  const claimB = { claim_id: "CLM_B" };
  const windows = [
    { claim: claimA, coverStart: 0, coverEnd: 20 },
    { claim: claimB, coverStart: 20, coverEnd: 30 }
  ];
  const slices = [{ start: 0, end: 20, kind: "concept_map" }];
  const holdSeconds = applyEvidenceHoldToNextWindow(windows, 0, windows[0].coverEnd, slices);
  assert.equal(holdSeconds, 0);
  assert.equal(windows[1].coverStart, 20);
});

test("applyEvidenceHoldToNextWindow: throws when the claim needing a hold is the film's last claim (nothing to hold into)", () => {
  const claimA = { claim_id: "CLM_LAST" };
  const windows = [{ claim: claimA, coverStart: 0, coverEnd: 2.16 }];
  const slices = [{ start: 0, end: 4.1, kind: "image_sequence" }];
  assert.throws(() => applyEvidenceHoldToNextWindow(windows, 0, windows[0].coverEnd, slices), /CLM_LAST.*no following claim/s);
});

test("applyEvidenceHoldToNextWindow: throws rather than leaving the next claim with a non-positive window", () => {
  const claimA = { claim_id: "CLM_A" };
  const claimB = { claim_id: "CLM_B" };
  const windows = [
    { claim: claimA, coverStart: 0, coverEnd: 2.16 },
    // CLM_B's own window is far too small to absorb a ~1.94s hold.
    { claim: claimB, coverStart: 2.16, coverEnd: 2.5 }
  ];
  const slices = [{ start: 0, end: 4.1, kind: "image_sequence" }];
  assert.throws(() => applyEvidenceHoldToNextWindow(windows, 0, windows[0].coverEnd, slices), /CLM_A.*CLM_B.*leaving it with none/s);
});

// expandFootageAssignments -- the direct replacement for the removed
// footageCandidateSlot/i%3 mechanism (task follow-up section 17): any slice
// index is addressable, and a single real clip may span several contiguous
// slices as one continuous, real-duration-verified pass instead of several
// separate uses.
test("expandFootageAssignments resolves a plain single-slice (span 1, default) assignment exactly as before", () => {
  const table = { CLM_TEST: { 2: { asset: "clip_a.mp4", trimInRatio: 0.5, motion: "hold", role: "context" } } };
  const sliceDurations = [6, 6, 6, 6];
  const expanded = expandFootageAssignments("CLM_TEST", sliceDurations, new Map([["clip_a.mp4", 20]]), table);
  assert.equal(expanded.size, 1);
  const entry = expanded.get(2);
  assert.equal(entry.asset, "clip_a.mp4");
  assert.equal(entry.trimInSec, 10); // 0.5 * 20, well under the 20 - 6 - 0.3 clamp
  assert.equal(entry.trimOutSec, 16);
});

test("expandFootageAssignments spans multiple contiguous slices with one continuous, contiguous trim", () => {
  const table = { CLM_TEST: { 1: { asset: "clip_a.mp4", trimInRatio: 0.1, span: 3, motion: "hold", role: "context" } } };
  const sliceDurations = [5, 5, 5, 5, 5];
  const expanded = expandFootageAssignments("CLM_TEST", sliceDurations, new Map([["clip_a.mp4", 30]]), table);
  assert.deepEqual([...expanded.keys()].sort(), [1, 2, 3]);
  const first = expanded.get(1);
  const second = expanded.get(2);
  const third = expanded.get(3);
  assert.equal(first.trimInSec, 3); // 0.1 * 30
  assert.equal(first.trimOutSec, 8); // + 5
  // Each subsequent slice's trim_in picks up exactly where the previous
  // one's trim_out left off -- true contiguity, not just "same asset".
  assert.equal(second.trimInSec, first.trimOutSec);
  assert.equal(second.trimOutSec, 13);
  assert.equal(third.trimInSec, second.trimOutSec);
  assert.equal(third.trimOutSec, 18);
});

test("expandFootageAssignments throws rather than silently overrunning a span past the clip's own real duration", () => {
  const table = { CLM_TEST: { 0: { asset: "clip_a.mp4", trimInRatio: 0.5, span: 2, motion: "hold", role: "context" } } };
  const sliceDurations = [7, 7];
  assert.throws(() => expandFootageAssignments("CLM_TEST", sliceDurations, new Map([["clip_a.mp4", 10]]), table), /overruns that real duration/);
});

test("expandFootageAssignments throws when a span reaches past the claim's own last slice", () => {
  const table = { CLM_TEST: { 0: { asset: "clip_a.mp4", trimInRatio: 0, span: 5, motion: "hold", role: "context" } } };
  const sliceDurations = [5, 5];
  assert.throws(() => expandFootageAssignments("CLM_TEST", sliceDurations, new Map([["clip_a.mp4", 100]]), table), /does not exist/);
});

test("expandFootageAssignments throws when two declared assignments both cover the same slice", () => {
  const table = { CLM_TEST: { 0: { asset: "clip_a.mp4", trimInRatio: 0, span: 2, motion: "hold", role: "context" }, 1: { asset: "clip_b.mp4", trimInRatio: 0, motion: "hold", role: "context" } } };
  const sliceDurations = [5, 5];
  const durations = new Map([["clip_a.mp4", 100], ["clip_b.mp4", 100]]);
  assert.throws(() => expandFootageAssignments("CLM_TEST", sliceDurations, durations, table), /more than one footage assignment/);
});

test("expandFootageAssignments returns an empty map for a claim with no declared assignments", () => {
  const expanded = expandFootageAssignments("CLM_NOT_IN_TABLE", [5, 5], new Map(), {});
  assert.equal(expanded.size, 0);
});

// Regression test for the "shot_XXX lacks evidence hierarchy"-adjacent proof
// failure: scripts/orvyq_edit_plan_tests.mjs asserts a footage shot's
// trim_out_sec - trim_in_sec matches its real frame-quantized on-screen
// length within 0.02s. Before quantizeShotsToFrames, a shot's own float
// `duration` could drift from that frame-quantized length by up to a full
// frame once cumulative Math.round(cursor * fps) rounding compounds across
// 100+ shots -- reproduced here with irregular real-world-shaped floats
// deliberately chosen to land near a frame boundary.
test("quantizeShotsToFrames: footage trims match their real frame-quantized on-screen length, even after 100+ shots of cumulative drift", () => {
  const fps = 30;
  const durations = [];
  for (let i = 0; i < 120; i += 1) durations.push(6.1 + ((i * 37) % 23) / 100);
  const shots = durations.map((duration, i) => ({
    asset_type: i % 3 === 2 ? "footage" : "evidence",
    duration,
    ...(i % 3 === 2 ? { trim_in_sec: (i * 1.7) % 40, trim_out_sec: (i * 1.7) % 40 + duration } : {})
  }));

  quantizeShotsToFrames(shots, fps);
  const withFrames = assignFrames(shots, fps, 11.3 /* a non-frame-exact starting cursor, like a real hookDuration */);

  for (const shot of withFrames) {
    if (shot.asset_type !== "footage") continue;
    const seconds = (shot.end_frame - shot.start_frame) / fps;
    const diff = Math.abs(shot.trim_out_sec - shot.trim_in_sec - seconds);
    assert.ok(diff < 0.001, `footage trim drifted ${diff}s from its real on-screen length`);
  }
});

test("quantizeShotsToFrames: leaves an already frame-exact duration and its footage trim unchanged (beyond millisecond rounding)", () => {
  const shots = [{ asset_type: "footage", duration: 6, trim_in_sec: 2, trim_out_sec: 8 }];
  quantizeShotsToFrames(shots, 30);
  assert.equal(shots[0].duration, 6);
  assert.equal(shots[0].trim_out_sec, 8);
});

test("shrinkGraphicBreakSliceToMax: leaves a slice already at or under maxSeconds untouched", () => {
  const checkpointTimes = [0, 5, 10];
  const isFixedCheckpoint = (cp) => cp === 0 || cp === 2;
  shrinkGraphicBreakSliceToMax(checkpointTimes, 0, 5, isFixedCheckpoint, 8, "CLM_TEST");
  assert.deepEqual(checkpointTimes, [0, 5, 10]);
});

test("shrinkGraphicBreakSliceToMax: shrinks by giving the saved time to a free right neighbor", () => {
  const checkpointTimes = [0, 7, 14, 21];
  const isFixedCheckpoint = (cp) => cp === 0 || cp === 3;
  shrinkGraphicBreakSliceToMax(checkpointTimes, 0, 5, isFixedCheckpoint, 10, "CLM_TEST");
  // excess = 7 - 5 = 2, absorbed by checkpoint 1 moving left: right neighbor
  // width becomes 14-5=9, still <= maxShotSeconds (10).
  assert.ok(Math.abs(checkpointTimes[1] - 5) < 1e-9);
  assert.ok(Math.abs(checkpointTimes[2] - 14) < 1e-9);
  assert.ok(Math.abs(checkpointTimes[1] - checkpointTimes[0] - 5) < 1e-9);
});

test("shrinkGraphicBreakSliceToMax: falls back to a free left neighbor when the right one is fixed", () => {
  const checkpointTimes = [0, 7, 14, 21];
  const isFixedCheckpoint = (cp) => cp === 0 || cp === 2;
  shrinkGraphicBreakSliceToMax(checkpointTimes, 1, 5, isFixedCheckpoint, 10, "CLM_TEST");
  // excess = 7 - 5 = 2, checkpoint 2 is fixed so checkpoint 1 must move
  // right instead: left neighbor width becomes 7+2=9, still <= 10.
  assert.ok(Math.abs(checkpointTimes[1] - 9) < 1e-9);
  assert.ok(Math.abs(checkpointTimes[2] - 14) < 1e-9);
  assert.ok(Math.abs(checkpointTimes[2] - checkpointTimes[1] - 5) < 1e-9);
});

test("shrinkGraphicBreakSliceToMax: splits saved time across both neighbors when neither can absorb it alone", () => {
  const checkpointTimes = [0, 7, 14, 21];
  const isFixedCheckpoint = (cp) => cp === 0 || cp === 3;
  shrinkGraphicBreakSliceToMax(checkpointTimes, 1, 3, isFixedCheckpoint, 9, "CLM_TEST");
  assert.deepEqual(checkpointTimes, [0, 9, 12, 21]);
});

test("shrinkGraphicBreakSliceToMax: throws when neither neighbor has spare room under the per-shot cap", () => {
  const checkpointTimes = [0, 7, 14, 21];
  const isFixedCheckpoint = (cp) => cp === 0 || cp === 3;
  assert.throws(() => {
    shrinkGraphicBreakSliceToMax(checkpointTimes, 0, 2, isFixedCheckpoint, 8, "CLM_TEST");
  }, /cannot shrink its graphic recap slice/);
});

test("resolveEvidenceOverrideAssets returns nothing when there is no matching override", () => {
  assert.deepEqual(resolveEvidenceOverrideAssets(undefined, "official_figure", 0), {});
  assert.deepEqual(resolveEvidenceOverrideAssets({ kind: "split_documents", evidence_asset_ids: ["A"], image_assets: ["a.png"] }, "official_figure", 0), {});
});

test("resolveEvidenceOverrideAssets attaches the full declared set to every occurrence by default (unchanged prior behavior)", () => {
  const override = { kind: "official_figure", evidence_asset_ids: ["A", "B"], image_assets: ["a.png", "b.png"] };
  assert.deepEqual(resolveEvidenceOverrideAssets(override, "official_figure", 0), { evidence_asset_ids: ["A", "B"], image_assets: ["a.png", "b.png"] });
  assert.deepEqual(resolveEvidenceOverrideAssets(override, "official_figure", 1), { evidence_asset_ids: ["A", "B"], image_assets: ["a.png", "b.png"] });
});

test("resolveEvidenceOverrideAssets cycles one distinct image per occurrence when distinct_image_per_occurrence is set (regression: CLM_006's shot_047 duplicate)", () => {
  const override = {
    kind: "split_documents",
    evidence_asset_ids: ["EVID_ISA_REV3_COVER", "EVID_ISA_OUTSTANDING_ISSUES_COVER"],
    image_assets: ["assets/evidence/isa_exploitation_regulations_rev3_cover.png", "assets/evidence/isa_outstanding_issues_cover.png"],
    distinct_image_per_occurrence: true
  };
  const first = resolveEvidenceOverrideAssets(override, "split_documents", 0);
  const second = resolveEvidenceOverrideAssets(override, "split_documents", 1);
  assert.deepEqual(first, { evidence_asset_ids: ["EVID_ISA_REV3_COVER"], image_assets: ["assets/evidence/isa_exploitation_regulations_rev3_cover.png"] });
  assert.deepEqual(second, { evidence_asset_ids: ["EVID_ISA_OUTSTANDING_ISSUES_COVER"], image_assets: ["assets/evidence/isa_outstanding_issues_cover.png"] });
  assert.notDeepEqual(first.image_assets, second.image_assets);
});

test("resolveEvidenceOverrideAssets wraps around when there are more occurrences than declared images", () => {
  const override = { kind: "official_figure", evidence_asset_ids: ["A", "B"], image_assets: ["a.png", "b.png"], distinct_image_per_occurrence: true };
  assert.deepEqual(resolveEvidenceOverrideAssets(override, "official_figure", 2), { evidence_asset_ids: ["A"], image_assets: ["a.png"] });
  assert.deepEqual(resolveEvidenceOverrideAssets(override, "official_figure", 3), { evidence_asset_ids: ["B"], image_assets: ["b.png"] });
});

test("sliceClaimWindow applies a selected project's declared graphic-break cap without losing timeline duration", async () => {
  await loadEditorialAssetPlan(firstReadyProjectId());
  const configured = Object.entries(GRAPHIC_BREAK_ASSIGNMENTS)
    .flatMap(([claimId, assignments]) => Object.entries(assignments)
      .filter(([, assignment]) => Number.isFinite(assignment.maxSeconds))
      .map(([sliceIndex, assignment]) => ({
        claimId,
        sliceIndex: Number(sliceIndex),
        maxSeconds: Number(assignment.maxSeconds),
      })))
    .find(({ claimId, sliceIndex }) => Number(SLICE_COUNT_OVERRIDES[claimId]) > sliceIndex + 1);
  assert.ok(configured, "a ready project must expose at least one testable graphic-break duration cap");

  const sliceCount = Number(SLICE_COUNT_OVERRIDES[configured.claimId]);
  const coverStart = 0;
  const coverEnd = sliceCount * 5;
  const maxShotSeconds = 15;
  const claim = {
    claim_id: configured.claimId,
    visual_treatment: { primary: "evidence_chain" },
  };
  const slices = sliceClaimWindow(claim, coverStart, coverEnd, maxShotSeconds, [], [], {});

  assert.equal(slices.length, sliceCount);
  assert.ok(
    Math.abs(slices[configured.sliceIndex].end - slices[configured.sliceIndex].start - configured.maxSeconds) < 1e-9,
  );
  assert.equal(slices[0].start, coverStart);
  for (let index = 1; index < slices.length; index += 1) {
    assert.ok(Math.abs(slices[index].start - slices[index - 1].end) < 1e-9);
  }
  assert.ok(Math.abs(slices.at(-1).end - coverEnd) < 1e-9);
  assert.ok(slices.every((slice) => slice.end - slice.start <= maxShotSeconds + 1e-9));
});
