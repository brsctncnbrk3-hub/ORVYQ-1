import test from "node:test";
import assert from "node:assert/strict";
import { assignStableShotKeys } from "./lib/orvyq-visual-rebalance.mjs";
import { resolveSemanticCorrectionTarget } from "./orvyq_validate_local_footage.mjs";

const target = {
  duration: 7.8,
  claim_id: "CLM_016_DECISION_UNDER_UNCERTAINTY",
  section_id: "SEC_06_MACHINE_LEAVES_BEHIND",
  source_slice_index: 0,
  asset_type: "footage",
  asset: "assets/footage/scene_035.mp4",
};
const key = "body:clm-016-decision-under-uncertainty:slice-0:sec-06-machine-leaves-behind:occ-1";

test("semantic corrections stay on the same shot when an earlier hook is removed", () => {
  const withHook = assignStableShotKeys([
    {
      duration: 3,
      claim_id: "CLM_HOOK",
      section_id: "SEC_01",
      asset_type: "footage",
      asset: "assets/footage/hook.mp4",
      hook_footage: true,
    },
    target,
  ]);
  const withoutHook = assignStableShotKeys([target]);
  const correction = { shot_index: 1, shot_key: key };

  assert.equal(resolveSemanticCorrectionTarget(withHook, correction, true).index, 1);
  assert.equal(resolveSemanticCorrectionTarget(withoutHook, correction, true).index, 0);
  assert.equal(resolveSemanticCorrectionTarget(withoutHook, correction, true).shot.claim_id, target.claim_id);
});

test("stable semantic corrections fail closed when their target is missing", () => {
  const shots = assignStableShotKeys([target]);
  assert.throws(
    () => resolveSemanticCorrectionTarget(shots, { shot_index: 0, shot_key: "body:missing:slice-0:sec:occ-1" }, true),
    /resolved 0 targets/,
  );
});

test("schema 1.1 semantic corrections cannot fall back to an array index", () => {
  const shots = assignStableShotKeys([target]);
  assert.throws(
    () => resolveSemanticCorrectionTarget(shots, { shot_index: 0 }, true),
    /requires shot_key/,
  );
});
