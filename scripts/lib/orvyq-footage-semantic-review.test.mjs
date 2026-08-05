import test from "node:test";
import assert from "node:assert/strict";
import { auditFootageSemanticReviews } from "./orvyq-footage-semantic-review.mjs";

test("rejected footage cannot return through another scene or backfill path", () => {
  const result = auditFootageSemanticReviews({
    footageAssets: ["assets/footage/scene_999_new-name.mp4"],
    provenanceByPath: new Map([[
      "assets/footage/scene_999_new-name.mp4",
      { provider_asset_id: "123", sha256: "a".repeat(64) },
    ]]),
    reviews: {
      rejected_assets: [{ provider_asset_id: "123", reason: "fishing boat is not a research vessel" }],
    },
  });
  assert.equal(result.pass, false);
  assert.equal(result.rejected.length, 1);
});

test("approval is byte-bound and narration-specific", () => {
  const asset = "assets/footage/context.mp4";
  const result = auditFootageSemanticReviews({
    footageAssets: [asset],
    provenanceByPath: new Map([[asset, { provider_asset_id: "456", sha256: "b".repeat(64) }]]),
    reviews: {
      approved_assets: [{
        provider_asset_id: "456",
        asset_sha256: "b".repeat(64),
        contact_sheet_sha256: "c".repeat(64),
        claim_id: "CLM_001",
        narration_anchor: "The exact sentence spoken during this shot.",
        semantic_rationale: "The vessel identity and deck operation directly support the narrated expedition action.",
      }],
    },
  });
  assert.equal(result.pass, true, result.failures.join("; "));
});

test("production audit requires an exact approval for every narration use", () => {
  const asset = "assets/footage/context.mp4";
  const result = auditFootageSemanticReviews({
    footageShots: [{
      asset,
      claim_id: "CLM_002",
      narration_anchor: "This exact narration must be reviewed.",
    }],
    provenanceByPath: new Map([[asset, { provider_asset_id: "789", sha256: "d".repeat(64) }]]),
    reviews: {
      approved_assets: [{
        provider_asset_id: "789",
        asset_sha256: "d".repeat(64),
        contact_sheet_sha256: "e".repeat(64),
        approved_uses: [{
          claim_id: "CLM_001",
          narration_anchor: "A different sentence.",
          semantic_rationale: "This rationale is deliberately tied to another narration use.",
        }],
      }],
    },
  });
  assert.equal(result.pass, false);
  assert.match(result.failures.join("; "), /no exact approved use/);
});

test("an explicit adjacent narration extension may reuse approved bytes only inside the same claim", () => {
  const asset = "assets/footage/context.mp4";
  const approval = {
    provider_asset_id: "900",
    asset_sha256: "f".repeat(64),
    contact_sheet_sha256: "1".repeat(64),
    approved_uses: [{
      claim_id: "CLM_010",
      narration_anchor: "The first reviewed sentence in this claim.",
      semantic_rationale: "The reviewed footage directly supports the physical setting described by this claim.",
    }],
  };
  const result = auditFootageSemanticReviews({
    footageShots: [{
      asset,
      claim_id: "CLM_010",
      narration_anchor: "The immediately adjacent sentence continues the same claim.",
      semantic_rationale: "The same physical setting remains visible while the claim continues into the adjacent narration slice.",
      claim_bound_extension: true,
      claim_bound_extension_basis: "The exact active bytes were already reviewed for this claim and the adjacent slice keeps the same semantic role.",
    }],
    provenanceByPath: new Map([[asset, { provider_asset_id: "900", sha256: "f".repeat(64) }]]),
    reviews: { approved_assets: [approval] },
  });
  assert.equal(result.pass, true, result.failures.join("; "));
});

test("narration_anchor punctuation/case drift from re-run ASR does not reject an otherwise-identical approved use", () => {
  const asset = "assets/footage/context.mp4";
  const result = auditFootageSemanticReviews({
    footageShots: [{
      asset,
      claim_id: "CLM_002",
      narration_anchor: "The difficult part is separating them, refining them, and turning them into magnets.",
    }],
    provenanceByPath: new Map([[asset, { provider_asset_id: "789", sha256: "d".repeat(64) }]]),
    reviews: {
      approved_assets: [{
        provider_asset_id: "789",
        asset_sha256: "d".repeat(64),
        contact_sheet_sha256: "e".repeat(64),
        approved_uses: [{
          claim_id: "CLM_002",
          narration_anchor: "the difficult part is separating them, refining them and turning them into magnets",
          semantic_rationale: "This mineral-supply image directly supports the narrated refining-bottleneck claim.",
        }],
      }],
    },
  });
  assert.equal(result.pass, true, result.failures.join("; "));
});

test("narration_anchor comparison still rejects a genuinely different narration window", () => {
  const asset = "assets/footage/context.mp4";
  const result = auditFootageSemanticReviews({
    footageShots: [{
      asset,
      claim_id: "CLM_002",
      narration_anchor: "A completely different sentence about a different topic entirely.",
    }],
    provenanceByPath: new Map([[asset, { provider_asset_id: "789", sha256: "d".repeat(64) }]]),
    reviews: {
      approved_assets: [{
        provider_asset_id: "789",
        asset_sha256: "d".repeat(64),
        contact_sheet_sha256: "e".repeat(64),
        approved_uses: [{
          claim_id: "CLM_002",
          narration_anchor: "the difficult part is separating them, refining them and turning them into magnets",
          semantic_rationale: "This mineral-supply image directly supports the narrated refining-bottleneck claim.",
        }],
      }],
    },
  });
  assert.equal(result.pass, false);
  assert.match(result.failures.join("; "), /no exact approved use/);
});

test("claim-bound extension cannot cross into a different claim", () => {
  const asset = "assets/footage/context.mp4";
  const result = auditFootageSemanticReviews({
    footageShots: [{
      asset,
      claim_id: "CLM_011",
      narration_anchor: "A different claim must not inherit the approval.",
      semantic_rationale: "This long rationale cannot override the claim identity boundary enforced by the audit.",
      claim_bound_extension: true,
      claim_bound_extension_basis: "The caller tried to label this as an extension even though the claim identity changed.",
    }],
    provenanceByPath: new Map([[asset, { provider_asset_id: "901", sha256: "2".repeat(64) }]]),
    reviews: {
      approved_assets: [{
        provider_asset_id: "901",
        asset_sha256: "2".repeat(64),
        contact_sheet_sha256: "3".repeat(64),
        approved_uses: [{
          claim_id: "CLM_010",
          narration_anchor: "The approved claim sentence.",
          semantic_rationale: "The reviewed footage directly supports only the original claim and not another claim.",
        }],
      }],
    },
  });
  assert.equal(result.pass, false);
  assert.match(result.failures.join("; "), /no exact approved use/);
});
