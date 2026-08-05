export const PRIMARY_EVIDENCE_KINDS = new Set([
  "split_documents",
  "official_document",
  "official_figure",
  "official_screen",
  "image_sequence",
  "recap",
]);

export const GRAPHIC_CARD_EVIDENCE_KINDS = new Set([
  "source_timeline",
  "source_article",
  "concept_map",
  "boundary",
  "comparison",
  "evidence_chain",
]);

const FULL_SCREEN_TEXT_CARD_TYPES = new Set([
  "section_title",
  "claim_recap_card",
  "end_card",
  "statement",
  "text_card",
]);

export const DEFAULT_VISUAL_MEDIUM_BALANCE = Object.freeze({
  contextual_footage_fraction_min: 0.60,
  contextual_footage_fraction_max: 0.70,
  primary_evidence_fraction_min: 0.20,
  graphic_card_fraction_max: 0.15,
  full_screen_text_card_fraction_max: 0.03,
  section_graphic_card_fraction_max: 0.25,
  maximum_consecutive_graphic_card_shots: 1,
  maximum_graphic_template_uses: 3,
  maximum_full_screen_template_uses: 2,
});

function finiteFraction(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : null;
}

function finiteInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function resolveVisualBalanceThresholds(rules = {}) {
  const configured = {
    footageMin: finiteFraction(
      rules.contextual_footage_fraction_min ??
      rules.contextual_body_footage_fraction_min,
    ),
    footageMax: finiteFraction(
      rules.contextual_footage_fraction_max ??
      rules.contextual_body_footage_fraction_max,
    ),
    evidenceMin: finiteFraction(
      rules.primary_evidence_fraction_min ??
      rules.official_primary_capture_fraction_min,
    ),
    cardMax: finiteFraction(
      rules.graphic_card_fraction_max ??
      rules.card_like_visual_fraction_max,
    ),
    fullScreenTextMax: finiteFraction(
      rules.full_screen_text_card_fraction_max ??
      rules.full_screen_graphic_fraction_max,
    ),
    sectionCardMax: finiteFraction(
      rules.section_graphic_card_fraction_max ??
      rules.section_card_like_visual_fraction_max,
    ),
    consecutiveMax: finiteInteger(rules.maximum_consecutive_graphic_card_shots),
    templateAllMax: finiteInteger(rules.maximum_graphic_template_uses),
    templateMax: finiteInteger(rules.maximum_full_screen_template_uses),
  };

  return {
    contextual_footage_fraction_min: Math.max(
      DEFAULT_VISUAL_MEDIUM_BALANCE.contextual_footage_fraction_min,
      configured.footageMin ?? 0,
    ),
    contextual_footage_fraction_max: Math.min(
      DEFAULT_VISUAL_MEDIUM_BALANCE.contextual_footage_fraction_max,
      configured.footageMax ?? 1,
    ),
    primary_evidence_fraction_min: Math.max(
      DEFAULT_VISUAL_MEDIUM_BALANCE.primary_evidence_fraction_min,
      configured.evidenceMin ?? 0,
    ),
    graphic_card_fraction_max: Math.min(
      DEFAULT_VISUAL_MEDIUM_BALANCE.graphic_card_fraction_max,
      configured.cardMax ?? 1,
    ),
    full_screen_text_card_fraction_max: Math.min(
      DEFAULT_VISUAL_MEDIUM_BALANCE.full_screen_text_card_fraction_max,
      configured.fullScreenTextMax ?? 1,
    ),
    section_graphic_card_fraction_max: Math.min(
      DEFAULT_VISUAL_MEDIUM_BALANCE.section_graphic_card_fraction_max,
      configured.sectionCardMax ?? 1,
    ),
    maximum_consecutive_graphic_card_shots: Math.min(
      DEFAULT_VISUAL_MEDIUM_BALANCE.maximum_consecutive_graphic_card_shots,
      configured.consecutiveMax ?? Number.POSITIVE_INFINITY,
    ),
    maximum_graphic_template_uses: Math.min(
      DEFAULT_VISUAL_MEDIUM_BALANCE.maximum_graphic_template_uses,
      configured.templateAllMax ?? Number.POSITIVE_INFINITY,
    ),
    maximum_full_screen_template_uses: Math.min(
      DEFAULT_VISUAL_MEDIUM_BALANCE.maximum_full_screen_template_uses,
      configured.templateMax ?? Number.POSITIVE_INFINITY,
    ),
  };
}

function durationFramesOf(shot) {
  if (Number.isFinite(shot?.start_frame) && Number.isFinite(shot?.end_frame)) {
    return Math.max(0, Number(shot.end_frame) - Number(shot.start_frame));
  }
  if (Number.isFinite(shot?.duration_frames)) return Math.max(0, Number(shot.duration_frames));
  if (Number.isFinite(shot?.duration)) return Math.max(0, Math.round(Number(shot.duration) * 30));
  return 0;
}

export function isDominantCardOverlay(shot) {
  return Boolean(shot?.emphasis_card || shot?.editorial_overlay || shot?.overlay);
}

export function classifyVisualMedium(shot) {
  if (!shot || typeof shot !== "object") return "invalid";
  if (shot.asset_type === "graphic") return "graphic_card";
  if (isDominantCardOverlay(shot)) return "graphic_card";
  if (shot.asset_type === "evidence") {
    const kind = shot.evidence?.kind;
    if (PRIMARY_EVIDENCE_KINDS.has(kind)) {
      const images = shot.evidence?.image_assets || [];
      const ids = shot.evidence?.evidence_asset_ids || [];
      return images.length > 0 && images.length === ids.length
        ? "primary_evidence"
        : "invalid";
    }
    if (GRAPHIC_CARD_EVIDENCE_KINDS.has(kind)) return "graphic_card";
    return "invalid";
  }
  if (shot.asset_type === "footage") return "contextual_footage";
  return "invalid";
}

export function isFullScreenTextCard(shot) {
  if (shot?.asset_type !== "graphic") return false;
  const type = shot.graphic?.type || "";
  return FULL_SCREEN_TEXT_CARD_TYPES.has(type) || shot.graphic?.mode === "statement";
}

function graphicTemplateKey(shot) {
  if (shot?.asset_type === "graphic") {
    return shot.graphic?.template_id || shot.graphic?.type || "graphic";
  }
  if (shot?.asset_type === "evidence" && GRAPHIC_CARD_EVIDENCE_KINDS.has(shot.evidence?.kind)) {
    return shot.evidence?.template_id || shot.evidence?.kind;
  }
  return null;
}

export function summarizeExclusiveVisualMedia(shots, durationFrames = null) {
  const computedDuration = shots.reduce((sum, shot) => sum + durationFramesOf(shot), 0);
  const duration = Number(durationFrames) > 0 ? Number(durationFrames) : computedDuration;
  const frames = {
    contextual_footage: 0,
    primary_evidence: 0,
    graphic_card: 0,
    invalid: 0,
    full_screen_text_card: 0,
  };
  const shotCounts = {
    contextual_footage: 0,
    primary_evidence: 0,
    graphic_card: 0,
    invalid: 0,
  };
  const templates = new Map();
  const fullScreenTemplates = new Map();
  let currentCardRun = 0;
  let maximumCardRun = 0;

  for (const shot of shots) {
    const frameCount = durationFramesOf(shot);
    const medium = classifyVisualMedium(shot);
    frames[medium] += frameCount;
    shotCounts[medium] += 1;
    if (isFullScreenTextCard(shot)) frames.full_screen_text_card += frameCount;
    if (medium === "graphic_card") {
      currentCardRun += 1;
      maximumCardRun = Math.max(maximumCardRun, currentCardRun);
      const template = graphicTemplateKey(shot);
      if (template) templates.set(template, (templates.get(template) || 0) + 1);
      if (template && isFullScreenTextCard(shot)) {
        fullScreenTemplates.set(template, (fullScreenTemplates.get(template) || 0) + 1);
      }
    } else {
      currentCardRun = 0;
    }
  }

  const safeDuration = duration > 0 ? duration : 1;
  return {
    duration_frames: duration,
    exclusive_frame_total:
      frames.contextual_footage +
      frames.primary_evidence +
      frames.graphic_card +
      frames.invalid,
    contextual_footage_frames: frames.contextual_footage,
    primary_evidence_frames: frames.primary_evidence,
    graphic_card_frames: frames.graphic_card,
    invalid_frames: frames.invalid,
    full_screen_text_card_frames: frames.full_screen_text_card,
    contextual_footage_fraction: frames.contextual_footage / safeDuration,
    primary_evidence_fraction: frames.primary_evidence / safeDuration,
    graphic_card_fraction: frames.graphic_card / safeDuration,
    invalid_fraction: frames.invalid / safeDuration,
    full_screen_text_card_fraction: frames.full_screen_text_card / safeDuration,
    maximum_consecutive_graphic_card_shots: maximumCardRun,
    graphic_template_uses: Object.fromEntries(templates),
    full_screen_template_uses: Object.fromEntries(fullScreenTemplates),
    shot_counts: shotCounts,
  };
}

export function auditVisualMediumBalance({ shots, durationFrames = null }, rules = {}) {
  const values = summarizeExclusiveVisualMedia(shots || [], durationFrames);
  const thresholds = resolveVisualBalanceThresholds(rules);
  const failures = [];
  const pct = (value) => `${(value * 100).toFixed(1)}%`;

  if (values.exclusive_frame_total !== values.duration_frames) {
    failures.push(
      `exclusive visual categories cover ${values.exclusive_frame_total} frames; timeline has ${values.duration_frames}`,
    );
  }
  if (values.invalid_frames > 0) {
    failures.push(`${values.invalid_frames} frame(s) have no structurally valid exclusive visual category`);
  }
  if (values.contextual_footage_fraction < thresholds.contextual_footage_fraction_min) {
    failures.push(
      `contextual footage ${pct(values.contextual_footage_fraction)}; minimum ${pct(thresholds.contextual_footage_fraction_min)}`,
    );
  }
  if (values.contextual_footage_fraction > thresholds.contextual_footage_fraction_max) {
    failures.push(
      `contextual footage ${pct(values.contextual_footage_fraction)}; maximum ${pct(thresholds.contextual_footage_fraction_max)}`,
    );
  }
  if (values.primary_evidence_fraction < thresholds.primary_evidence_fraction_min) {
    failures.push(
      `real primary evidence ${pct(values.primary_evidence_fraction)}; minimum ${pct(thresholds.primary_evidence_fraction_min)}`,
    );
  }
  if (values.graphic_card_fraction > thresholds.graphic_card_fraction_max) {
    failures.push(
      `graphics and cards ${pct(values.graphic_card_fraction)}; maximum ${pct(thresholds.graphic_card_fraction_max)}`,
    );
  }
  if (values.full_screen_text_card_fraction > thresholds.full_screen_text_card_fraction_max) {
    failures.push(
      `full-screen text cards ${pct(values.full_screen_text_card_fraction)}; maximum ${pct(thresholds.full_screen_text_card_fraction_max)}`,
    );
  }
  if (
    values.maximum_consecutive_graphic_card_shots >
    thresholds.maximum_consecutive_graphic_card_shots
  ) {
    failures.push(
      `graphic/card run reaches ${values.maximum_consecutive_graphic_card_shots} consecutive shots; maximum ${thresholds.maximum_consecutive_graphic_card_shots}`,
    );
  }
  for (const [template, count] of Object.entries(values.full_screen_template_uses)) {
    if (count > thresholds.maximum_full_screen_template_uses) {
      failures.push(
        `full-screen graphic template ${template} is used ${count} times; maximum ${thresholds.maximum_full_screen_template_uses}`,
      );
    }
  }
  for (const [template, count] of Object.entries(values.graphic_template_uses)) {
    if (count > thresholds.maximum_graphic_template_uses) {
      failures.push(
        `graphic/card template ${template} is used ${count} times; maximum ${thresholds.maximum_graphic_template_uses}`,
      );
    }
  }

  return { ...values, thresholds, failures, pass: failures.length === 0 };
}

export function auditSectionVisualBalance(shots, rules = {}) {
  const thresholds = resolveVisualBalanceThresholds(rules);
  const grouped = new Map();
  for (const shot of shots || []) {
    const sectionId = shot.section_id || "UNASSIGNED";
    const section = grouped.get(sectionId) || [];
    section.push(shot);
    grouped.set(sectionId, section);
  }
  const sections = [];
  const failures = [];
  for (const [sectionId, sectionShots] of grouped) {
    const values = summarizeExclusiveVisualMedia(sectionShots);
    sections.push({ section_id: sectionId, ...values });
    if (values.graphic_card_fraction > thresholds.section_graphic_card_fraction_max) {
      const graphicShots = sectionShots
        .filter((shot) => classifyVisualMedium(shot) === "graphic_card")
        .map((shot) => ({
          shot_id: shot.shot_id,
          claim_id: shot.claim_id,
          frames: durationFramesOf(shot),
        }));
      failures.push(
        `section ${sectionId} is ${(values.graphic_card_fraction * 100).toFixed(1)}% graphics/cards; maximum ${(thresholds.section_graphic_card_fraction_max * 100).toFixed(0)}% [DEBUG duration_frames=${values.duration_frames} graphic_card_frames=${values.graphic_card_frames} shots=${JSON.stringify(graphicShots)}]`,
      );
    }
    if (
      values.maximum_consecutive_graphic_card_shots >
      thresholds.maximum_consecutive_graphic_card_shots
    ) {
      failures.push(
        `section ${sectionId} reaches ${values.maximum_consecutive_graphic_card_shots} consecutive graphic/card shots`,
      );
    }
  }
  return { sections, failures, pass: failures.length === 0 };
}

export function auditGraphicCardDesign(shots) {
  const failures = [];
  const necessities = new Set(["comparison", "timeline", "geography", "mechanism", "critical_result"]);
  for (const shot of shots || []) {
    if (classifyVisualMedium(shot) !== "graphic_card") continue;
    if (shot.asset_type === "graphic") {
      const graphic = shot.graphic || {};
      if (String(graphic.title || "").length > 58) failures.push(`${shot.shot_id || shot.claim_id} graphic title exceeds 58 characters`);
      if (String(graphic.subtitle || "").length > 92) failures.push(`${shot.shot_id || shot.claim_id} graphic subtitle exceeds 92 characters`);
      if ((graphic.labels || []).length > 4) failures.push(`${shot.shot_id || shot.claim_id} graphic has more than four labels`);
      if (!graphic.template_id) failures.push(`${shot.shot_id || shot.claim_id} graphic requires a named ORVYQ template_id`);
      if (!necessities.has(graphic.necessity)) failures.push(`${shot.shot_id || shot.claim_id} graphic lacks an allowed necessity`);
    }
    if (shot.asset_type === "evidence" && GRAPHIC_CARD_EVIDENCE_KINDS.has(shot.evidence?.kind)) {
      const evidence = shot.evidence || {};
      if (String(evidence.title || "").length > 72) failures.push(`${shot.shot_id || shot.claim_id} source-derived card title exceeds 72 characters`);
      if ((evidence.items || []).length > 4 || (evidence.steps || []).length > 4) {
        failures.push(`${shot.shot_id || shot.claim_id} source-derived card has more than four concepts`);
      }
      if (!evidence.template_id) failures.push(`${shot.shot_id || shot.claim_id} source-derived card requires template_id`);
      if (!necessities.has(evidence.necessity)) failures.push(`${shot.shot_id || shot.claim_id} source-derived card lacks an allowed necessity`);
    }
  }
  return { failures, pass: failures.length === 0 };
}
