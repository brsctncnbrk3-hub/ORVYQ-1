import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import {
  measureVisualMix,
  resolveVerifiedPrimaryEvidenceRequests,
} from "./orvyq_finalize_visual_rebalance.mjs";

test("measureVisualMix reports mutually exclusive measured media", () => {
  const report = measureVisualMix([
    { duration: 2, asset_type: "footage", contextual_footage: true },
    {
      duration: 1,
      asset_type: "evidence",
      evidence: {
        kind: "official_figure",
        source_ids: ["SRC_ONE"],
        image_assets: ["assets/evidence/official.png"],
        evidence_asset_ids: ["EVID_OFFICIAL"],
      },
    },
    { duration: 1, asset_type: "graphic", graphic: { type: "boundary" } },
  ]);

  assert.equal(report.duration_frames, 120);
  assert.equal(report.contextual_footage_fraction, 0.5);
  assert.equal(report.primary_evidence_fraction, 0.25);
  assert.equal(report.graphic_card_fraction, 0.25);
});

test("verified primary-evidence requests promote only after byte-bound runtime proof", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "orvyq-finalize-"));
  const localAsset = "assets/evidence/official-page.png";
  await fs.mkdir(path.join(dir, "assets", "evidence"), { recursive: true });
  await fs.writeFile(path.join(dir, localAsset), Buffer.from("verified primary evidence"));

  const requests = {
    requests: [{
      asset_request_id: "REQ_EVD_OFFICIAL_REPORT",
      type: "primary_evidence",
      status: "pending_direct_asset",
      claim_ids: ["CLM_TEST"],
      resolved_asset_paths: [localAsset],
      resolved_evidence_asset_ids: ["EVID_OFFICIAL_PAGE"],
    }],
  };
  const evidenceAssetManifest = {
    assets: [{ evidence_asset_id: "EVID_OFFICIAL_PAGE", status: "ready" }],
  };
  const primaryEvidenceManifest = {
    assets: [{ evidence_asset_id: "EVID_OFFICIAL_PAGE", local_asset: localAsset }],
  };
  const runtime = {
    assets: [{
      evidence_asset_id: "EVID_OFFICIAL_PAGE",
      local_asset: localAsset,
      sha256: "a".repeat(64),
    }],
  };

  try {
    const result = await resolveVerifiedPrimaryEvidenceRequests({
      dir,
      requests,
      evidenceAssetManifest,
      primaryEvidenceManifest,
      runtime,
    });
    assert.deepEqual(result, {
      promotedRequestIds: ["REQ_EVD_OFFICIAL_REPORT"],
      unresolved: [],
    });
    assert.equal(requests.requests[0].status, "ready");

    requests.requests[0].status = "pending_direct_asset";
    runtime.assets[0].sha256 = "not-a-sha";
    const rejected = await resolveVerifiedPrimaryEvidenceRequests({
      dir,
      requests,
      evidenceAssetManifest,
      primaryEvidenceManifest,
      runtime,
    });
    assert.equal(rejected.promotedRequestIds.length, 0);
    assert.match(rejected.unresolved[0].failures.join(" "), /no verified SHA-256/);
    assert.equal(requests.requests[0].status, "pending_direct_asset");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
