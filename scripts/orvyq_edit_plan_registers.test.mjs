import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRegisterFrames } from "./orvyq_edit_plan.mjs";

// Registers B and C exist in Scene.tsx/Video.tsx but were never carried onto a
// built shot, so a blueprint could author either one and the plan would drop
// it in silence -- leaving the full-screen graphic card as the only answer for
// a section turn or an unfilmable claim. These cover the rule that now gates
// them.

const heldSpec = {
  asset_type: "footage",
  held_frame: { kicker: "Section 04", title: "The scale the decision sits inside" },
};

const evidenceSpec = {
  asset_type: "graphic",
  evidence_frame: {
    title: "The lab's own safety framework",
    source: "Anthropic · Claude 4 System Card · May 2025",
    document_asset: "assets/evidence/anthropic_asl3_cover.png",
  },
};

test("a shot with neither register resolves to two nulls", () => {
  const result = resolveRegisterFrames({ asset_type: "footage" }, "shot");
  assert.deepEqual(result, { heldFrame: null, evidenceFrame: null });
});

test("a held frame over footage is carried through", () => {
  const { heldFrame, evidenceFrame } = resolveRegisterFrames(heldSpec, "shot");
  assert.equal(heldFrame.title, "The scale the decision sits inside");
  assert.equal(evidenceFrame, null);
});

test("a held frame without footage under it is rejected, not silently turned into a card", () => {
  for (const assetType of ["graphic", "evidence"]) {
    assert.throws(
      () => resolveRegisterFrames({ ...heldSpec, asset_type: assetType }, "shot"),
      /held_frame requires footage/,
    );
  }
});

test("a held frame without a title is rejected", () => {
  assert.throws(
    () => resolveRegisterFrames({ asset_type: "footage", held_frame: { kicker: "Section 04" } }, "shot"),
    /held_frame requires a title/,
  );
});

test("an evidence frame is carried through on a non-footage shot", () => {
  const { heldFrame, evidenceFrame } = resolveRegisterFrames(evidenceSpec, "shot");
  assert.equal(heldFrame, null);
  assert.equal(evidenceFrame.document_asset, "assets/evidence/anthropic_asl3_cover.png");
});

test("an evidence frame without a document is rejected: the document is the register", () => {
  const { document_asset, ...withoutDocument } = evidenceSpec.evidence_frame;
  assert.throws(
    () => resolveRegisterFrames({ ...evidenceSpec, evidence_frame: withoutDocument }, "shot"),
    /evidence_frame requires document_asset/,
  );
});

test("an evidence frame without a visible source is rejected", () => {
  const { source, ...withoutSource } = evidenceSpec.evidence_frame;
  assert.throws(
    () => resolveRegisterFrames({ ...evidenceSpec, evidence_frame: withoutSource }, "shot"),
    /requires a title and a visible source/,
  );
});

test("holding the shot and replacing it with a document at once is rejected", () => {
  assert.throws(
    () =>
      resolveRegisterFrames(
        { asset_type: "footage", held_frame: heldSpec.held_frame, evidence_frame: evidenceSpec.evidence_frame },
        "shot",
      ),
    /cannot hold the shot and replace it/,
  );
});

test("the failure names the shot it came from", () => {
  assert.throws(
    () => resolveRegisterFrames({ ...heldSpec, asset_type: "graphic" }, "full_production.shots[41]"),
    /full_production\.shots\[41\]/,
  );
});
