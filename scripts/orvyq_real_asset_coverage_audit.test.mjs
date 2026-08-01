import { test } from "node:test";
import assert from "node:assert/strict";
import { auditRealAssetCoverage } from "./orvyq_real_asset_coverage_audit.mjs";

const FPS = 30;

function withFrames(shots) {
  let cursor = 0;
  return shots.map((s) => {
    const start_frame = cursor;
    cursor += Math.round(s.duration * FPS);
    return { ...s, start_frame, end_frame: cursor };
  });
}

// Regression fixture: the rejected review (run 30132412035) is confirmed to
// have "effectively 0" real rendered document/report/article/chart assets
// -- every evidence shot used a NATIVE_KINDS card. This must hard-fail.
test("regression: zero real evidence assets (the rejected review's actual state) hard-fails", () => {
  const shots = withFrames([
    { shot_id: "s1", section_id: "SEC_01", asset_type: "evidence", claim_id: "CLM_001", evidence: { kind: "concept_map", steps: ["a"] }, duration: 6 },
    { shot_id: "s2", section_id: "SEC_01", asset_type: "evidence", claim_id: "CLM_002", evidence: { kind: "comparison", left: "x", right: "y" }, duration: 6 }
  ]);
  const result = auditRealAssetCoverage(shots, FPS);
  assert.equal(result.real_evidence_asset_count, 0);
  assert.ok(result.failures.some((f) => f.includes("zero real evidence assets")));
});

test("a shot claiming an IMAGE_KINDS kind with no image_assets is a fake metadata card and fails", () => {
  const shots = withFrames([{ shot_id: "s1", section_id: "SEC_01", asset_type: "evidence", claim_id: "CLM_001", evidence: { kind: "official_document", evidence_asset_ids: ["EVID_A"], image_assets: [] }, duration: 6 }]);
  const result = auditRealAssetCoverage(shots, FPS);
  assert.ok(result.failures.some((f) => f.includes("fake metadata card")));
});

test("at least one real, correctly-backed evidence shot passes the hard gate and is counted", () => {
  const shots = withFrames([
    { shot_id: "s1", section_id: "SEC_01", asset_type: "evidence", claim_id: "CLM_001", evidence: { kind: "official_document", evidence_asset_ids: ["EVID_A"], image_assets: ["assets/evidence/a.png"] }, duration: 6 },
    { shot_id: "s2", section_id: "SEC_01", asset_type: "evidence", claim_id: "CLM_002", evidence: { kind: "concept_map", steps: ["a"] }, duration: 6 }
  ]);
  const result = auditRealAssetCoverage(shots, FPS);
  assert.equal(result.failures.length, 0);
  assert.equal(result.real_evidence_asset_count, 1);
  assert.ok(result.real_evidence_fraction > 0);
});

test("a section with fewer than 2 distinct real assets is warned, not hard-failed", () => {
  const shots = withFrames([{ shot_id: "s1", section_id: "SEC_01", asset_type: "evidence", claim_id: "CLM_001", evidence: { kind: "official_document", evidence_asset_ids: ["EVID_A"], image_assets: ["assets/evidence/a.png"] }, duration: 6 }]);
  const result = auditRealAssetCoverage(shots, FPS);
  assert.equal(result.failures.length, 0, "under-target section coverage must be a warning, not a hard failure, given this session's real network constraints");
  assert.ok(result.warnings.some((w) => w.includes("SEC_01")));
});
