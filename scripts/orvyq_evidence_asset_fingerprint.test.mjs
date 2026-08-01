import test from "node:test";
import assert from "node:assert/strict";
import { auditEvidenceFingerprints } from "./orvyq_evidence_asset_audit.mjs";

test("different crops of the same evidence content do not count as diversity", () => {
  const result = auditEvidenceFingerprints([
    { evidence_asset_id: "A", content_identity: "DOC:PAGE-4:FIG-2", sha256: "a".repeat(64) },
    { evidence_asset_id: "B", content_identity: "DOC:PAGE-4:FIG-2", sha256: "b".repeat(64) },
  ]);
  assert.equal(result.unique_content_identity_count, 1);
  assert.match(result.failures.join("; "), /duplicates content identity/);
});

test("byte-identical evidence under another id fails", () => {
  const result = auditEvidenceFingerprints([
    { evidence_asset_id: "A", content_identity: "DOC:PAGE-1", sha256: "a".repeat(64) },
    { evidence_asset_id: "B", content_identity: "DOC:PAGE-2", sha256: "a".repeat(64) },
  ]);
  assert.match(result.failures.join("; "), /duplicates evidence bytes/);
});
