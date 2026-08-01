import { test } from "node:test";
import assert from "node:assert/strict";
import { auditLeakedInstructions } from "./orvyq_leaked_instruction_audit.mjs";

// Regression fixture: the exact strings the task brief confirms leaked to
// screen in the rejected review (run 30132412035).
const REJECTED_REVIEW_LEAKED_STRINGS = [
  "Do not imply all labs hold identical views.",
  "Show official article title/date.",
  "Add authoritative market or company evidence; do not use decorative stock tickers.",
  "Show the report title/date and case summary."
];

test("regression: a shot displaying the rejected review's real leaked evidence_requirements string fails", () => {
  const shots = [
    { shot_id: "shot_010", asset_type: "evidence", evidence: { eyebrow: "EVIDENCE BOUNDARY", title: "What this establishes", items: [{ label: "EVIDENCE BOUNDARY", value: "Do not imply all labs hold identical views.", detail: "" }] } }
  ];
  const result = auditLeakedInstructions(shots, REJECTED_REVIEW_LEAKED_STRINGS);
  assert.ok(result.failures.length > 0);
  assert.ok(result.failures.some((f) => f.includes("Do not imply all labs hold identical views.")));
});

test("regression: a graphic card title carrying a raw production instruction fails", () => {
  const shots = [{ shot_id: "shot_020", asset_type: "graphic", graphic: { title: "Show official article title/date.", subtitle: null } }];
  const result = auditLeakedInstructions(shots, REJECTED_REVIEW_LEAKED_STRINGS);
  assert.ok(result.failures.some((f) => f.includes("Show official article title/date.")));
});

test("a shot displaying only real, legitimate content passes", () => {
  const shots = [
    {
      shot_id: "shot_030",
      asset_type: "evidence",
      evidence: { eyebrow: "ANTHROPIC — PRIMARY EVIDENCE", title: "Anthropic: Responsible Scaling Policy", limitation: "A published policy commitment is evidence of documented governance, not proof of identical practice.", source_label: "Anthropic" }
    },
    { shot_id: "shot_031", asset_type: "graphic", graphic: { title: "The Race Paradox", subtitle: "What happens when capability moves faster than control?" } }
  ];
  const result = auditLeakedInstructions(shots, REJECTED_REVIEW_LEAKED_STRINGS);
  assert.equal(result.failures.length, 0);
});

test("generic imperative-instruction phrasing not present in the known-strings list is still caught", () => {
  const shots = [{ shot_id: "shot_040", asset_type: "graphic", graphic: { title: "Editor note: replace with a stronger visual", subtitle: null } }];
  const result = auditLeakedInstructions(shots, []);
  assert.ok(result.failures.length > 0, "a novel instruction-shaped string with no matching known-strings entry must still be caught by pattern matching");
});

test("a short common substring (e.g. a single word) never spuriously matches across shots", () => {
  const shots = [{ shot_id: "shot_050", asset_type: "graphic", graphic: { title: "Not someday.", subtitle: "Right now." } }];
  // A trivially short instruction fragment must not cause false positives.
  const result = auditLeakedInstructions(shots, ["now"]);
  assert.equal(result.failures.length, 0);
});
