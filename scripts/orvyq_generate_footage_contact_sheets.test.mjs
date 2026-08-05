import test from "node:test";
import assert from "node:assert/strict";
import { canReuseApprovedContactSheet, exactByteApproval } from "./orvyq_generate_footage_contact_sheets.mjs";

const assetHash = "a".repeat(64);
const reviews = {
  approved_assets: [{
    provider_asset_id: "28668454",
    asset_sha256: assetHash,
    contact_sheet_sha256: "b".repeat(64),
  }],
};

test("an exact-byte approval skips generation only when its contact sheet exists", () => {
  assert.equal(exactByteApproval(reviews, "28668454", assetHash)?.contact_sheet_sha256, "b".repeat(64));
  assert.equal(canReuseApprovedContactSheet(reviews, "28668454", assetHash, true), true);
  assert.equal(canReuseApprovedContactSheet(reviews, "28668454", assetHash, false), false);
});

test("a different asset hash never reuses the old contact-sheet approval", () => {
  assert.equal(canReuseApprovedContactSheet(reviews, "28668454", "c".repeat(64), true), false);
});
