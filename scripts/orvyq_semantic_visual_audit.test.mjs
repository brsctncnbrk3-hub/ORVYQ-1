import test from "node:test";
import assert from "node:assert/strict";
import { presentationMotifKey } from "./orvyq_semantic_visual_audit.mjs";

test("official evidence with the same source title but different captured figures is not one repeated motif", () => {
  const base = {
    asset_type: "evidence",
    evidence: {
      kind: "official_figure",
      title: "JAMSTEC: Results",
      limitation: "A technical result is not commercial viability.",
    },
  };
  const first = { ...base, evidence: { ...base.evidence, image_assets: ["first-mud.jpg"] } };
  const second = { ...base, evidence: { ...base.evidence, image_assets: ["trial-diagram.png"] } };
  assert.notEqual(presentationMotifKey(first), presentationMotifKey(second));
});

test("source-derived evidence with the same citation title but different reader-facing claims is not one repeated motif", () => {
  const base = {
    asset_type: "evidence",
    evidence: {
      kind: "boundary",
      title: "IEA: Rare Earth Elements",
      limitation: "Figures concern magnet rare earths.",
    },
  };
  const concentration = { ...base, evidence: { ...base.evidence, left: "China produced about sixty percent.", right: "Production is concentrated." } };
  const controls = { ...base, evidence: { ...base.evidence, left: "Export controls materialized the risk.", right: "Supply tightened." } };
  assert.notEqual(presentationMotifKey(concentration), presentationMotifKey(controls));
});

test("an exact reader-facing evidence presentation retains one stable motif key", () => {
  const shot = {
    asset_type: "evidence",
    evidence: {
      kind: "comparison",
      title: "Observed result",
      left: "Before",
      right: "After",
      limitation: "One measured trial.",
    },
  };
  assert.equal(presentationMotifKey(shot), presentationMotifKey(structuredClone(shot)));
});
