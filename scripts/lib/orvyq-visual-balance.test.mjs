import test from "node:test";
import assert from "node:assert/strict";
import {
  auditGraphicCardDesign,
  DEFAULT_VISUAL_MEDIUM_BALANCE,
  auditSectionVisualBalance,
  auditVisualMediumBalance,
  classifyVisualMedium,
  isStillDerivedFootage,
  resolveVisualBalanceThresholds,
  summarizeExclusiveVisualMedia,
} from "./orvyq-visual-balance.mjs";

const footage = (start, end, extra = {}) => ({
  asset_type: "footage",
  start_frame: start,
  end_frame: end,
  section_id: "SEC_01",
  ...extra,
});
const primary = (start, end, extra = {}) => ({
  asset_type: "evidence",
  start_frame: start,
  end_frame: end,
  section_id: "SEC_01",
  evidence: {
    kind: "official_figure",
    image_assets: ["figure.png"],
    evidence_asset_ids: ["EVID_FIGURE"],
  },
  ...extra,
});
const card = (start, end, type = "claim_recap_card", extra = {}) => ({
  asset_type: "graphic",
  start_frame: start,
  end_frame: end,
  section_id: "SEC_01",
  graphic: { type, title: "One necessary conclusion" },
  ...extra,
});

test("visual-medium balance accepts mutually exclusive 65/22/13 footage-evidence-card mix", () => {
  const result = auditVisualMediumBalance({
    durationFrames: 1000,
    shots: [footage(0, 650), primary(650, 870), card(870, 1000, "comparison")],
  });
  assert.equal(result.pass, true);
  assert.equal(result.contextual_footage_fraction, 0.65);
  assert.equal(result.primary_evidence_fraction, 0.22);
  assert.equal(result.graphic_card_fraction, 0.13);
  assert.equal(
    result.contextual_footage_fraction +
      result.primary_evidence_fraction +
      result.graphic_card_fraction,
    1,
  );
});

test("a real document remains primary evidence even when presented in a designed evidence frame", () => {
  assert.equal(classifyVisualMedium(primary(0, 100)), "primary_evidence");
});

test("a decorative evidence-shaped object cannot be counted as primary evidence", () => {
  assert.equal(
    classifyVisualMedium({
      asset_type: "evidence",
      evidence: { kind: "official_document", image_assets: [], evidence_asset_ids: [] },
    }),
    "invalid",
  );
});

test("a card overlay on footage is counted once as a card, never double-counted as footage", () => {
  const result = auditVisualMediumBalance({
    durationFrames: 1000,
    shots: [
      footage(0, 600),
      primary(600, 800),
      footage(800, 850, { emphasis_card: { title: "Pause", eyebrow: "THINK" } }),
      card(850, 1000, "comparison"),
    ],
  });
  assert.equal(result.contextual_footage_fraction, 0.60);
  assert.equal(result.primary_evidence_fraction, 0.20);
  assert.equal(result.graphic_card_fraction, 0.20);
  assert.equal(result.pass, false);
});

test("project rules may tighten shared thresholds but cannot loosen them", () => {
  const resolved = resolveVisualBalanceThresholds({
    contextual_footage_fraction_min: 0.64,
    contextual_footage_fraction_max: 0.95,
    primary_evidence_fraction_min: 0.10,
    graphic_card_fraction_max: 0.90,
    full_screen_text_card_fraction_max: 0.02,
    section_graphic_card_fraction_max: 0.90,
    maximum_consecutive_graphic_card_shots: 5,
  });
  assert.equal(resolved.contextual_footage_fraction_min, 0.64);
  assert.equal(
    resolved.contextual_footage_fraction_max,
    DEFAULT_VISUAL_MEDIUM_BALANCE.contextual_footage_fraction_max,
  );
  assert.equal(
    resolved.primary_evidence_fraction_min,
    DEFAULT_VISUAL_MEDIUM_BALANCE.primary_evidence_fraction_min,
  );
  assert.equal(
    resolved.graphic_card_fraction_max,
    DEFAULT_VISUAL_MEDIUM_BALANCE.graphic_card_fraction_max,
  );
  assert.equal(resolved.full_screen_text_card_fraction_max, 0.02);
  assert.equal(
    resolved.section_graphic_card_fraction_max,
    DEFAULT_VISUAL_MEDIUM_BALANCE.section_graphic_card_fraction_max,
  );
  assert.equal(
    resolved.maximum_consecutive_graphic_card_shots,
    DEFAULT_VISUAL_MEDIUM_BALANCE.maximum_consecutive_graphic_card_shots,
  );
});

test("two adjacent graphics/cards fail closed", () => {
  const result = auditVisualMediumBalance({
    durationFrames: 1000,
    shots: [
      footage(0, 600),
      primary(600, 800),
      card(800, 900, "comparison"),
      card(900, 1000, "process"),
    ],
  });
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.includes("consecutive")));
});

test("section balance rejects local card clustering hidden by healthy film totals", () => {
  const shots = [
    footage(0, 700, { section_id: "SEC_01" }),
    primary(700, 900, { section_id: "SEC_01" }),
    card(900, 1000, "comparison", { section_id: "SEC_01" }),
    footage(1000, 1500, { section_id: "SEC_02" }),
    primary(1500, 1700, { section_id: "SEC_02" }),
    card(1700, 2000, "comparison", { section_id: "SEC_02" }),
  ];
  const result = auditSectionVisualBalance(shots);
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.includes("SEC_02")));
});

test("graphic design gate requires concise copy, named templates, and factual necessity", () => {
  const valid = card(0, 90, "comparison", {
    shot_id: "shot_001",
    graphic: {
      type: "comparison",
      title: "Capability is not obligation",
      subtitle: "A demonstrated system does not settle the policy decision.",
      labels: ["Demonstrated", "Not decided"],
      template_id: "orvyq_single_comparison",
      necessity: "comparison",
    },
  });
  assert.equal(auditGraphicCardDesign([valid]).pass, true);
  const invalid = card(0, 90, "comparison", {
    shot_id: "shot_002",
    graphic: { type: "comparison", title: "A".repeat(80), labels: ["one", "two", "three", "four", "five"] },
  });
  const result = auditGraphicCardDesign([invalid]);
  assert.equal(result.pass, false);
  assert.ok(result.failures.length >= 3);
});

test("a moved still counts as contextual footage, never as primary evidence", () => {
  const shots = [
    { asset_type: "footage", asset: "assets/footage/scene_001_a.mp4", duration: 6 },
    { asset_type: "footage", asset: "assets/stills/scene_002_a.jpg", still_image: true, duration: 4 },
  ];
  const summary = summarizeExclusiveVisualMedia(shots);
  assert.equal(summary.primary_evidence_frames, 0, "a photograph is not source-backed evidence");
  assert.equal(summary.contextual_footage_frames, 300);
  assert.equal(summary.still_derived_frames, 120);
  assert.equal(Math.round(summary.still_derived_share_of_contextual_footage * 100), 40);
});

test("a still is recognised from its extension even without the flag", () => {
  assert.equal(isStillDerivedFootage({ asset_type: "footage", asset: "a/b/c.jpg" }), true);
  assert.equal(isStillDerivedFootage({ asset_type: "footage", asset: "a/b/c.mp4" }), false);
  assert.equal(isStillDerivedFootage({ asset_type: "evidence", asset: "a/b/c.jpg" }), false);
});

test("stills beyond their share of contextual footage fail", () => {
  const shots = [
    { asset_type: "footage", asset: "clip.mp4", duration: 10 },
    { asset_type: "footage", asset: "still.jpg", duration: 4 },
    { asset_type: "evidence", duration: 6, evidence: { kind: "official_document", image_assets: ["a.png"], evidence_asset_ids: ["EVID_A"] } },
  ];
  const report = auditVisualMediumBalance({ shots });
  assert.ok(report.failures.some((failure) => /moved stills carry/.test(failure)));
});

test("consecutive stills fail even when the total share is small", () => {
  const shots = [
    ...Array.from({ length: 20 }, () => ({ asset_type: "footage", asset: "clip.mp4", duration: 6 })),
    { asset_type: "footage", asset: "one.jpg", duration: 3 },
    { asset_type: "footage", asset: "two.jpg", duration: 3 },
  ];
  const report = auditVisualMediumBalance({ shots });
  assert.ok(report.failures.some((failure) => /still run reaches 2 consecutive/.test(failure)));
});

test("a still held too long fails", () => {
  const shots = [
    ...Array.from({ length: 30 }, () => ({ asset_type: "footage", asset: "clip.mp4", duration: 6 })),
    { asset_type: "footage", asset: "long.jpg", duration: 9 },
  ];
  const report = auditVisualMediumBalance({ shots });
  assert.ok(report.failures.some((failure) => /a still holds for 9\.00s/.test(failure)));
});

test("a project may tighten the still ceilings but not loosen them", () => {
  const loosened = resolveVisualBalanceThresholds({
    still_derived_contextual_fraction_max: 0.9,
    maximum_consecutive_still_shots: 5,
    maximum_still_shot_seconds: 20,
  });
  assert.equal(loosened.still_derived_contextual_fraction_max, 0.12);
  assert.equal(loosened.maximum_consecutive_still_shots, 1);
  assert.equal(loosened.maximum_still_shot_seconds, 5);

  const tightened = resolveVisualBalanceThresholds({ still_derived_contextual_fraction_max: 0.05 });
  assert.equal(tightened.still_derived_contextual_fraction_max, 0.05);
});
