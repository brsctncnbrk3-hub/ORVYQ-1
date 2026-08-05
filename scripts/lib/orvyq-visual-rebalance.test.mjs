import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assignStableShotKeys,
  auditVisualRebalancePlan,
  materializeVisualRebalancePlan,
  resolveVisualRebalancePlan,
  resolveVisualRebalanceTargets,
} from "./orvyq-visual-rebalance.mjs";

function shot(duration, asset_type, section_id, extra = {}) {
  return {
    duration,
    asset_type,
    section_id,
    claim_id: extra.claim_id || "CLM_001",
    ...extra,
  };
}

function primaryEvidenceAsset(overrides = {}) {
  return {
    evidence_asset_id: "EVID_OFFICIAL",
    source_ids: ["SRC_OFFICIAL"],
    source_url: "https://example.org/official-source.pdf",
    source_institution: "Official Agency",
    source_title: "Official Source Publication",
    source_date: "2026-07-31",
    content_identity: "SRC_OFFICIAL:figure-1",
    caption: "Official Agency — verified Figure 1",
    limitation: "The figure supports only the specific result shown.",
    ...overrides,
  };
}

test("rebalance decisions are exclusive, complete, and tighten-only compliant", () => {
  const shots = [
    shot(65, "footage", "SEC_01"),
    shot(22, "evidence", "SEC_01", {
      evidence: { kind: "official_document", image_assets: ["a.png"], evidence_asset_ids: ["A"] },
    }),
    shot(13, "graphic", "SEC_01", { graphic: { type: "claim_recap_card" } }),
  ];
  const plan = {
    actions: [{
      baseline_shot_index: 2,
      claim_id: "CLM_001",
      duration_seconds: 13,
      decision: "redesign",
      projected_medium: "graphic_card",
      projected_full_screen_text_card: false,
      template_id: "orvyq_single_comparison",
    }],
  };
  const result = auditVisualRebalancePlan({ shots, plan });
  assert.equal(result.pass, true, result.failures.join("; "));
  assert.equal(result.projected_fractions.graphic_card, 0.13);
});

test("missing replacement asset fails closed", () => {
  const shots = [
    shot(65, "footage", "SEC_01"),
    shot(22, "evidence", "SEC_01", {
      evidence: { kind: "official_document", image_assets: ["a.png"], evidence_asset_ids: ["A"] },
    }),
    shot(13, "graphic", "SEC_01", { graphic: { type: "claim_recap_card" } }),
  ];
  const plan = {
    actions: [{
      baseline_shot_index: 2,
      claim_id: "CLM_001",
      duration_seconds: 13,
      decision: "replace_contextual_footage",
      projected_medium: "contextual_footage",
      asset_request_id: "REQ_001",
    }],
  };
  const result = auditVisualRebalancePlan({
    shots,
    plan,
    assetRequests: [{ asset_request_id: "REQ_001", status: "pending_acquisition" }],
  });
  assert.equal(result.editorial_plan_pass, false);
  assert.match(result.failures.join("; "), /contextual footage/);
  assert.equal(result.materialization_ready, false);
});

test("materialization replaces cards with exact evidence, attribution, and footage assets", () => {
  const shots = [
    shot(8, "graphic", "SEC_01", {
      graphic: { type: "claim_recap_card" },
      narration_anchor: "Official evidence appears here.",
    }),
    shot(7, "graphic", "SEC_01", {
      graphic: { type: "claim_recap_card" },
      narration_anchor: "Physical process appears here.",
    }),
  ];
  const requests = [
    { asset_request_id: "REQ_EVD_DIRECT", status: "ready" },
    { asset_request_id: "REQ_FTG_DIRECT", status: "ready" },
  ];
  const plan = {
    status: "materialized",
    actions: [
      {
        baseline_shot_index: 0,
        claim_id: "CLM_001",
        duration_seconds: 8,
        decision: "replace_primary_evidence",
        projected_medium: "primary_evidence",
        asset_request_id: "REQ_EVD_DIRECT",
        rationale: "Use the exact official source figure for the narrated claim.",
        replacement_assets: [{
          asset_path: "assets/evidence/official.png",
          evidence_asset_id: "EVID_OFFICIAL",
          source_region: "Figure 1",
        }],
      },
      {
        baseline_shot_index: 1,
        claim_id: "CLM_001",
        duration_seconds: 7,
        decision: "replace_contextual_footage",
        projected_medium: "contextual_footage",
        asset_request_id: "REQ_FTG_DIRECT",
        rationale: "Use a physically direct process shot for the narrated action.",
        replacement_assets: [{
          asset_path: "assets/footage/direct.mp4",
          trim_in_sec: 2,
          trim_out_sec: 10,
        }],
      },
    ],
  };

  const result = materializeVisualRebalancePlan({
    shots,
    plan,
    assetRequests: requests,
    primaryEvidenceAssets: [primaryEvidenceAsset()],
  });
  assert.equal(result[0].asset_type, "evidence");
  assert.deepEqual(result[0].evidence.evidence_asset_ids, ["EVID_OFFICIAL"]);
  assert.deepEqual(result[0].evidence.source_ids, ["SRC_OFFICIAL"]);
  assert.equal(result[0].evidence.source_label, "Official Agency — 2026-07-31");
  assert.equal(result[0].evidence.title, "Official Agency — verified Figure 1");
  assert.equal(result[0].evidence.eyebrow, "OFFICIAL AGENCY — PRIMARY EVIDENCE");
  assert.equal(result[1].asset_type, "footage");
  assert.equal(result[1].asset, "assets/footage/direct.mp4");
  assert.equal(result[1].trim_in_sec, 2);
  assert.equal(result[1].trim_out_sec, 9);
  assert.equal(result[1].trim_out_sec - result[1].trim_in_sec, result[1].duration);
});

test("replacing a native-kind evidence shot's primary evidence drops its stale items/steps/left/right body", () => {
  const shots = [
    shot(8, "evidence", "SEC_01", {
      evidence: {
        kind: "evidence_chain",
        source_ids: ["SRC_A", "SRC_B", "SRC_C"],
        source_label: "Multiple verified sources (recap)",
        eyebrow: "SRC A — PRIMARY EVIDENCE",
        title: "Source A: some recap title",
        steps: ["Source A (Jan 1, 2020): Title A", "Source B (Feb 2, 2021): Title B"],
        limitation: "Attributed commentary, not a measured or universal industry finding.",
      },
    }),
  ];
  const requests = [{ asset_request_id: "REQ_EVD_DIRECT", status: "ready" }];
  const plan = {
    status: "materialized",
    actions: [{
      baseline_shot_index: 0,
      claim_id: "CLM_001",
      duration_seconds: 8,
      decision: "replace_primary_evidence",
      projected_medium: "primary_evidence",
      asset_request_id: "REQ_EVD_DIRECT",
      rationale: "Use the exact official source figure for the narrated claim.",
      replacement_assets: [{
        asset_path: "assets/evidence/official.png",
        evidence_asset_id: "EVID_OFFICIAL",
        source_region: "Figure 1",
      }],
    }],
  };

  const result = materializeVisualRebalancePlan({
    shots,
    plan,
    assetRequests: requests,
    primaryEvidenceAssets: [primaryEvidenceAsset()],
  });
  assert.equal(result[0].evidence.kind, "official_figure");
  assert.deepEqual(result[0].evidence.source_ids, ["SRC_OFFICIAL"]);
  assert.equal(result[0].evidence.steps, undefined);
  assert.equal(result[0].evidence.items, undefined);
  assert.equal(result[0].evidence.left, undefined);
  assert.equal(result[0].evidence.right, undefined);
});

test("footage replacement fails closed when the available source window is shorter than the generated shot", () => {
  const shots = [shot(7, "graphic", "SEC_01", { graphic: { type: "claim_recap_card" } })];
  const plan = {
    status: "materialized",
    actions: [{
      baseline_shot_index: 0,
      claim_id: "CLM_001",
      duration_seconds: 7,
      decision: "replace_contextual_footage",
      projected_medium: "contextual_footage",
      asset_request_id: "REQ_FTG_DIRECT",
      rationale: "Use a physically direct process shot for the narrated action.",
      replacement_assets: [{
        asset_path: "assets/footage/direct.mp4",
        trim_in_sec: 2,
        trim_out_sec: 8.5,
      }],
    }],
  };

  assert.throws(
    () => materializeVisualRebalancePlan({
      shots,
      plan,
      assetRequests: [{ asset_request_id: "REQ_FTG_DIRECT", status: "ready" }],
    }),
    /footage replacement is shorter than the shot/,
  );
});

test("primary-evidence replacement fails closed when canonical provenance is missing", () => {
  const shots = [shot(8, "graphic", "SEC_01", { graphic: { type: "claim_recap_card" } })];
  const plan = {
    status: "materialized",
    actions: [{
      baseline_shot_index: 0,
      claim_id: "CLM_001",
      duration_seconds: 8,
      decision: "replace_primary_evidence",
      projected_medium: "primary_evidence",
      asset_request_id: "REQ_EVD_DIRECT",
      rationale: "Use the exact official source figure for the narrated claim.",
      replacement_assets: [{
        asset_path: "assets/evidence/official.png",
        evidence_asset_id: "EVID_OFFICIAL",
        source_region: "Figure 1",
      }],
    }],
  };

  assert.throws(
    () => materializeVisualRebalancePlan({
      shots,
      plan,
      assetRequests: [{ asset_request_id: "REQ_EVD_DIRECT", status: "ready" }],
      primaryEvidenceAssets: [primaryEvidenceAsset({ source_date: "" })],
    }),
    /lacks canonical provenance fields: source_date/,
  );
});

test("validated action override converts a redundant evidence beat into contiguous approved footage", () => {
  const shots = [
    shot(7, "footage", "SEC_01", {
      asset: "assets/footage/abyss.mp4",
      trim_in_sec: 1,
      trim_out_sec: 8,
      visual_role: "context",
      motion: "push",
      contextual_footage: true,
      generic_stock: false,
      semantic_link: "physical",
      semantic_rationale: "The verified abyssal view establishes the physical setting.",
    }),
    shot(6, "graphic", "SEC_01", {
      graphic: { type: "claim_recap_card" },
      narration_anchor: "The nodules formed layer by layer.",
    }),
  ];
  const plan = {
    status: "materialized",
    actions: [{
      baseline_shot_index: 1,
      claim_id: "CLM_001",
      duration_seconds: 6,
      decision: "replace_primary_evidence",
      projected_medium: "primary_evidence",
      asset_request_id: "REQ_EVD_DIRECT",
      rationale: "Use the source document.",
      replacement_assets: [{
        asset_path: "assets/evidence/official.png",
        evidence_asset_id: "EVID_OFFICIAL",
      }],
    }],
  };
  const actionOverrides = [{
    baseline_shot_index: 1,
    expected_decision: "replace_primary_evidence",
    action: {
      decision: "remove",
      projected_medium: "contextual_footage",
      replacement_strategy: "extend_adjacent_footage",
      rationale: "Continue the approved abyssal footage through the physical formation sentence.",
    },
  }];

  const result = materializeVisualRebalancePlan({ shots, plan, actionOverrides });
  assert.equal(result[1].asset_type, "footage");
  assert.equal(result[1].asset, "assets/footage/abyss.mp4");
  assert.equal(result[1].trim_in_sec, 8);
  assert.equal(result[1].trim_out_sec, 14);
  assert.equal(result[1].motion, "push");
  assert.equal(result[1].generic_stock, false);
  assert.equal(result[1].evidence, undefined);
  assert.equal(result[1].claim_bound_extension, true);
  assert.match(result[1].claim_bound_extension_basis, /same claim/);
});

test("a removable bridge can extend following same-claim footage when its predecessor is not footage", () => {
  const shots = [
    shot(2.5, "graphic", "SEC_01", {
      claim_id: "CLM_001",
      graphic: { type: "section_title", title: "Section" },
    }),
    shot(7, "footage", "SEC_01", {
      claim_id: "CLM_001",
      asset: "assets/footage/industry.mp4",
      trim_in_sec: 1.25,
      trim_out_sec: 8.25,
      visual_role: "context",
      motion: "pull",
      contextual_footage: true,
      generic_stock: false,
      semantic_link: "physical",
    }),
  ];
  const plan = {
    status: "materialized",
    actions: [{
      baseline_shot_index: 0,
      claim_id: "CLM_001",
      duration_seconds: 2.5,
      decision: "remove",
      projected_medium: "contextual_footage",
      replacement_strategy: "extend_adjacent_footage",
      rationale: "Continue the following approved footage through the short bridge.",
    }],
  };

  const result = materializeVisualRebalancePlan({ shots, plan });
  assert.equal(result[0].asset, "assets/footage/industry.mp4");
  assert.equal(result[0].trim_in_sec, 0);
  assert.equal(result[0].trim_out_sec, 2.5);
  assert.equal(result[1].trim_in_sec, 2.5);
  assert.equal(result[1].trim_out_sec, 9.5);
  assert.equal(result[0].motion, "pull");
  assert.equal(result[0].claim_bound_extension, true);
  assert.match(result[0].claim_bound_extension_basis, /same claim/);
});

test("an adjacent-footage extension cannot inherit a predecessor from another claim", () => {
  const shots = [
    shot(4, "footage", "SEC_01", {
      claim_id: "CLM_OTHER",
      asset: "assets/footage/other-claim.mp4",
      trim_in_sec: 0,
      trim_out_sec: 4,
      visual_role: "context",
      contextual_footage: true,
      semantic_link: "physical",
    }),
    shot(2.5, "graphic", "SEC_01", {
      claim_id: "CLM_001",
      graphic: { type: "section_title", title: "Section" },
    }),
  ];
  const plan = {
    status: "materialized",
    actions: [{
      baseline_shot_index: 1,
      claim_id: "CLM_001",
      duration_seconds: 2.5,
      decision: "remove",
      projected_medium: "contextual_footage",
      replacement_strategy: "extend_adjacent_footage",
      rationale: "Do not cross the claim boundary while extending adjacent footage.",
    }],
  };

  assert.throws(
    () => materializeVisualRebalancePlan({ shots, plan }),
    /cannot extend adjacent same-claim footage/,
  );
});

test("visual-rebalance override rejects stale expected decisions", () => {
  const plan = {
    actions: [{
      baseline_shot_index: 2,
      claim_id: "CLM_001",
      duration_seconds: 6,
      decision: "redesign",
      projected_medium: "graphic_card",
    }],
  };
  assert.throws(
    () => resolveVisualRebalancePlan(plan, [{
      baseline_shot_index: 2,
      expected_decision: "replace_primary_evidence",
      action: {
        decision: "remove",
        projected_medium: "contextual_footage",
        replacement_strategy: "extend_adjacent_footage",
      },
    }]),
    /expected replace_primary_evidence, found redesign/,
  );
});

test("materialization redesigns source-derived graphic-card evidence", () => {
  const shots = [
    shot(8, "evidence", "SEC_01", {
      evidence: {
        kind: "concept_map",
        template_id: "legacy_concept_map",
        necessity: "mechanism",
        title: "A source-derived comparison",
        source_ids: ["SRC_001"],
      },
    }),
  ];
  const plan = {
    status: "materialized",
    actions: [{
      baseline_shot_index: 0,
      claim_id: "CLM_001",
      duration_seconds: 8,
      decision: "redesign",
      projected_medium: "graphic_card",
      template_id: "orvyq_single_comparison",
      rationale: "Keep one concise source-derived comparison in the cinematic design system.",
    }],
  };

  const result = materializeVisualRebalancePlan({ shots, plan });
  assert.equal(result[0].asset_type, "evidence");
  assert.equal(result[0].evidence.kind, "concept_map");
  assert.equal(result[0].evidence.template_id, "orvyq_single_comparison");
  assert.equal(result[0].evidence.design_system, "orvyq_cinematic_v1");
});

test("stable shot_key keeps a redesign on the same semantic shot after an optional hook is removed", () => {
  const keyed = assignStableShotKeys([
    shot(3, "footage", "SEC_01", {
      claim_id: "CLM_HOOK",
      source_slice_index: null,
      hook_footage: true,
      asset: "assets/footage/optional-hook.mp4",
    }),
    shot(65, "footage", "SEC_01", { claim_id: "CLM_001", source_slice_index: 0 }),
    shot(22, "evidence", "SEC_01", {
      claim_id: "CLM_001",
      source_slice_index: 1,
      evidence: {
        kind: "official_figure",
        image_assets: ["official.png"],
        evidence_asset_ids: ["EVID_OFFICIAL"],
      },
    }),
    shot(13, "graphic", "SEC_01", {
      claim_id: "CLM_001",
      source_slice_index: null,
      graphic: { type: "section_title", title: "Section One" },
    }),
  ]);
  const targetKey = keyed[3].shot_key;
  const plan = {
    schema_version: "1.1",
    project_id: "999-stable-key-fixture",
    status: "materialized",
    actions: [{
      shot_key: targetKey,
      baseline_shot_index: 3,
      claim_id: "CLM_001",
      duration_seconds: 13,
      decision: "redesign",
      projected_medium: "graphic_card",
      template_id: "orvyq_section_sting",
      rationale: "Keep the semantic section transition attached to its stable authored identity.",
    }],
  };

  const withoutHook = keyed.filter((shotSpec) => shotSpec.hook_footage !== true);
  const materialized = materializeVisualRebalancePlan({ shots: withoutHook, plan });
  assert.equal(materialized[2].shot_key, targetKey);
  assert.equal(materialized[2].graphic.template_id, "orvyq_section_sting");
  assert.equal(materialized[1].asset_type, "evidence");
});

test("inserting an unrelated shot cannot shift a stable rebalance target", () => {
  const keyed = assignStableShotKeys([
    shot(65, "footage", "SEC_01", { claim_id: "CLM_001", source_slice_index: 0 }),
    shot(22, "evidence", "SEC_01", {
      claim_id: "CLM_001",
      source_slice_index: 1,
      evidence: {
        kind: "official_figure",
        image_assets: ["official.png"],
        evidence_asset_ids: ["EVID_OFFICIAL"],
      },
    }),
    shot(13, "graphic", "SEC_01", {
      claim_id: "CLM_001",
      source_slice_index: null,
      graphic: { type: "section_title", title: "Section One" },
    }),
  ]);
  const targetKey = keyed[2].shot_key;
  const inserted = assignStableShotKeys([
    shot(4, "footage", "SEC_00", { claim_id: "CLM_OTHER", source_slice_index: 0 }),
    ...keyed,
  ]);
  const plan = {
    schema_version: "1.1",
    project_id: "999-stable-key-fixture",
    status: "materialized",
    actions: [{
      shot_key: targetKey,
      baseline_shot_index: 2,
      claim_id: "CLM_001",
      duration_seconds: 13,
      decision: "redesign",
      projected_medium: "graphic_card",
      template_id: "orvyq_section_sting",
      rationale: "Keep the semantic section transition attached to its stable authored identity.",
    }],
  };
  const targets = resolveVisualRebalanceTargets({ shots: inserted, plan });
  assert.equal(targets.failures.length, 0);
  assert.equal(targets.actionIndexByKey.get(targetKey), 3);
});

test("production plans fail closed for a missing or duplicate stable target", () => {
  const keyed = assignStableShotKeys([
    shot(8, "graphic", "SEC_01", {
      claim_id: "CLM_001",
      source_slice_index: 0,
      graphic: { type: "claim_recap_card", title: "Claim" },
    }),
  ]);
  const plan = {
    schema_version: "1.1",
    project_id: "999-stable-key-fixture",
    status: "materialized",
    actions: [{
      shot_key: "body:clm-missing:slice-0:sec-01:occ-1",
      baseline_shot_index: 0,
      claim_id: "CLM_001",
      duration_seconds: 8,
      decision: "redesign",
      projected_medium: "graphic_card",
      template_id: "orvyq_single_comparison",
      rationale: "A missing semantic target must stop materialization instead of falling back to position.",
    }],
  };
  assert.throws(() => materializeVisualRebalancePlan({ shots: keyed, plan }), /unresolved visual-rebalance shot_key/);

  const duplicate = [keyed[0], { ...keyed[0] }];
  assert.throws(() => materializeVisualRebalancePlan({ shots: duplicate, plan }), /shot_key drift|duplicate shot_key/);
});

test("materializer and audit resolve the same stable shot_key", () => {
  const keyed = assignStableShotKeys([
    shot(65, "footage", "SEC_01", { claim_id: "CLM_001", source_slice_index: 0 }),
    shot(22, "evidence", "SEC_01", {
      claim_id: "CLM_001",
      source_slice_index: 1,
      evidence: {
        kind: "official_figure",
        image_assets: ["official.png"],
        evidence_asset_ids: ["EVID_OFFICIAL"],
      },
    }),
    shot(13, "graphic", "SEC_01", {
      claim_id: "CLM_001",
      source_slice_index: null,
      graphic: { type: "section_title", title: "Section One" },
    }),
  ]);
  const targetKey = keyed[2].shot_key;
  const plan = {
    schema_version: "1.1",
    project_id: "999-stable-key-fixture",
    status: "materialized",
    actions: [{
      shot_key: targetKey,
      baseline_shot_index: 2,
      claim_id: "CLM_001",
      duration_seconds: 13,
      decision: "redesign",
      projected_medium: "graphic_card",
      projected_full_screen_text_card: false,
      template_id: "orvyq_section_sting",
      rationale: "Keep the semantic section transition attached to its stable authored identity.",
    }],
  };
  const materialized = materializeVisualRebalancePlan({ shots: keyed, plan });
  const audit = auditVisualRebalancePlan({ shots: materialized, plan });
  assert.equal(audit.pass, true, audit.failures.join("; "));
  assert.equal(audit.resolved_action_targets[targetKey], 2);
  assert.equal(materialized[2].shot_key, targetKey);
});

test("Project 002 first redesign remains bound to the section title when the fifth hook is removed", () => {
  const blueprint = JSON.parse(readFileSync(new URL(
    "../../projects/002-the-new-war-beneath-the-ocean/direction/editorial_blueprint.json",
    import.meta.url,
  ), "utf8"));
  const plan = JSON.parse(readFileSync(new URL(
    "../../projects/002-the-new-war-beneath-the-ocean/direction/visual_rebalance_plan.json",
    import.meta.url,
  ), "utf8"));
  const baseline = assignStableShotKeys(blueprint.full_production.shots);
  const firstAction = plan.actions[0];
  const before = resolveVisualRebalanceTargets({ shots: baseline, plan, actionOverrides: [] });
  assert.equal(before.actionIndexByKey.get(firstAction.shot_key), 6);
  assert.equal(before.shots[6].graphic.type, "section_title");

  const afterHookBudget = baseline.filter((_, index) => index !== 4);
  const after = resolveVisualRebalanceTargets({ shots: afterHookBudget, plan, actionOverrides: [] });
  assert.equal(after.failures.length, 0, after.failures.join("; "));
  assert.equal(after.actionIndexByKey.get(firstAction.shot_key), 5);
  assert.equal(after.shots[5].graphic.type, "section_title");
});

test("Project 002 extends adjacent footage instead of materializing a 2.5s CLM_009 official document", () => {
  const plan = JSON.parse(readFileSync(new URL(
    "../../projects/002-the-new-war-beneath-the-ocean/direction/visual_rebalance_plan.json",
    import.meta.url,
  ), "utf8"));
  const overrides = JSON.parse(readFileSync(new URL(
    "../../projects/002-the-new-war-beneath-the-ocean/direction/visual_rebalance_overrides.json",
    import.meta.url,
  ), "utf8"));
  const effective = resolveVisualRebalancePlan(plan, overrides);
  const action = effective.actions.find((entry) =>
    entry.shot_key === "body:clm-009-industry-counterargument:unsliced:sec-05-argument-for-mining:occ-1"
  );

  assert.equal(action.duration_seconds, 2.5);
  assert.equal(action.decision, "remove");
  assert.equal(action.projected_medium, "contextual_footage");
  assert.equal(action.replacement_strategy, "extend_adjacent_footage");
  assert.equal(action.replacement_assets, undefined);
});
