import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSemanticCandidate, matchesSemanticText } from "./orvyq_acquire_footage_demand.mjs";

const constrain = (overrides) => ({
  semantic_title_constraints: {
    required_any_groups: [],
    forbidden_terms: [],
    min_metadata_required_groups: 1,
    ...overrides,
  },
});

// A scene may carry editorial guidance -- what must be visible, what must not
// -- without a metadata term list. Demanding "at least one of zero groups"
// makes every candidate unmatchable, which does not read as a filter bug from
// the outside: the run simply resolves nothing and exhausts its search budget.
test("no authored groups means no positive metadata requirement", () => {
  const result = evaluateSemanticCandidate("European parliament building exterior", constrain({}));
  assert.notEqual(result, null);
  assert.equal(result.metadataMatchedGroups, 0);
  assert.equal(result.fullyMetadataMatched, true);
});

test("forbidden terms still bar a candidate when no groups are authored", () => {
  assert.equal(evaluateSemanticCandidate("humanoid robot walking", constrain({ forbidden_terms: ["robot"] })), null);
  assert.notEqual(evaluateSemanticCandidate("server room racks", constrain({ forbidden_terms: ["robot"] })), null);
});

test("an authored group is still required", () => {
  const item = constrain({ required_any_groups: [["parliament", "government"]] });
  assert.equal(matchesSemanticText("parliament building exterior", item), true);
  assert.equal(matchesSemanticText("a cat asleep on a sofa", item), false);
});

test("min_metadata_required_groups cannot exceed the groups actually authored", () => {
  const item = constrain({ required_any_groups: [["parliament"]], min_metadata_required_groups: 5 });
  assert.equal(matchesSemanticText("parliament building", item), true);
});

test("a scene with no constraints at all is unconstrained", () => {
  const result = evaluateSemanticCandidate("anything at all", {});
  assert.equal(result.score, 0);
  assert.equal(result.fullyMetadataMatched, true);
});
