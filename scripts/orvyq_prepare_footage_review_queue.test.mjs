import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  requiresClaimBoundReview,
  requiresPendingManifestEntry,
  resolveContactSheetIdentity,
} from "./orvyq_prepare_footage_review_queue.mjs";

const currentUse = {
  claim_id: "CLM_009_INDUSTRY_COUNTERARGUMENT",
  narration_anchor: "The world now has one ocean, two rule books and no commercial precedent.",
  semantic_rationale: "A real formal assembly provides restrained human governance context while primary sources retain every factual burden.",
};

const exactApproval = {
  asset_sha256: "a".repeat(64),
  approved_uses: [{ ...currentUse }],
};

test("claim-bound review remains valid when bytes, claim, and narration anchor are unchanged", () => {
  assert.equal(requiresClaimBoundReview({
    currentUses: [currentUse],
    approval: exactApproval,
    assetSha256: "a".repeat(64),
  }), false);
});

test("an approved clip is requeued when its narration use changes", () => {
  assert.equal(requiresClaimBoundReview({
    currentUses: [{ ...currentUse, narration_anchor: "A newly assigned narration beat." }],
    approval: exactApproval,
    assetSha256: "a".repeat(64),
  }), true);
});

test("an approved clip is requeued when the current bytes change", () => {
  assert.equal(requiresClaimBoundReview({
    currentUses: [currentUse],
    approval: exactApproval,
    assetSha256: "b".repeat(64),
  }), true);
});

test("an unapproved clip with an exact current use is queued", () => {
  assert.equal(requiresClaimBoundReview({
    currentUses: [currentUse],
    approval: null,
    assetSha256: "a".repeat(64),
  }), true);
});

test("an unused asset is not queued solely because approval is absent", () => {
  assert.equal(requiresClaimBoundReview({
    currentUses: [],
    approval: null,
    assetSha256: "a".repeat(64),
  }), false);
});

test("a previous pending manifest entry is pruned after exact byte-bound approval", () => {
  assert.equal(requiresPendingManifestEntry({
    currentUses: [currentUse],
    approval: exactApproval,
    assetSha256: "a".repeat(64),
  }), false);
});

test("a previous pending manifest entry stays open until its bytes receive approval", () => {
  assert.equal(requiresPendingManifestEntry({
    currentUses: [],
    approval: null,
    assetSha256: "a".repeat(64),
  }), true);
});

test("Git LFS contact-sheet pointers resolve to the visual object SHA", () => {
  const objectSha = "c".repeat(64);
  const pointer = Buffer.from(
    `version https://git-lfs.github.com/spec/v1\noid sha256:${objectSha}\nsize 614489\n`,
  );
  const identity = resolveContactSheetIdentity(pointer);
  assert.equal(identity.contact_sheet_sha256, objectSha);
  assert.equal(identity.contact_sheet_is_lfs_pointer, true);
  assert.match(identity.contact_sheet_pointer_sha256, /^[0-9a-f]{64}$/);
  assert.notEqual(identity.contact_sheet_pointer_sha256, objectSha);
});

test("materialized contact sheets retain their direct byte SHA", () => {
  const identity = resolveContactSheetIdentity(Buffer.from("real jpeg fixture bytes"));
  assert.match(identity.contact_sheet_sha256, /^[0-9a-f]{64}$/);
  assert.equal(identity.contact_sheet_pointer_sha256, null);
  assert.equal(identity.contact_sheet_is_lfs_pointer, false);
});

test("claim-bound queue excludes planning-only editorial assignment anchors", () => {
  const source = fs.readFileSync(new URL("./orvyq_prepare_footage_review_queue.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /editorial_asset_plan\.json/);
  assert.doesNotMatch(source, /footage_assignments/);
});
