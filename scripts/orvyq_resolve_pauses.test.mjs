import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCanonicalPausePlan } from "./orvyq_resolve_pauses.mjs";
import { firstReadyProjectId } from "./lib/test-ready-project.mjs";

const PROJECT_ID = firstReadyProjectId();

test("resolveCanonicalPausePlan resolves a ready project's authored anchors into a valid timeline", async () => {
  const plan = await resolveCanonicalPausePlan(PROJECT_ID);
  assert.equal(plan.project_id, PROJECT_ID);
  assert.ok(plan.pauses.length >= 1);
  assert.ok(plan.narration_end_seconds > 0);

  let previousSourceTime = -Infinity;
  for (const pause of plan.pauses) {
    assert.ok(pause.pause_id);
    assert.ok(pause.anchor_text);
    assert.ok(pause.question);
    assert.ok(pause.sound_cue);
    assert.ok(Number.isFinite(pause.source_time_seconds));
    assert.ok(pause.source_time_seconds >= 0);
    assert.ok(pause.source_time_seconds <= plan.narration_end_seconds);
    assert.ok(pause.source_time_seconds > previousSourceTime, "resolved pauses must remain in narration order");
    assert.ok(pause.duration_seconds > 0);
    previousSourceTime = pause.source_time_seconds;
  }
});
