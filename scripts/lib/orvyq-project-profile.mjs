import path from "node:path";
import {
  REPO_ROOT,
  assertValidProjectId,
  projectDir,
  readJson,
  CliError,
} from "./fs-utils.mjs";

export const SYSTEM_PROFILE_PATH = path.join(REPO_ROOT, "config", "orvyq-system-profile.json");
export const PROJECT_PROFILE_RELATIVE_PATH = path.join("config", "production_profile.json");

export function resolveProjectId(args = {}, { required = true } = {}) {
  const value = args["project-id"] || process.env.ORVYQ_PROJECT_ID || null;
  if (!value) {
    if (!required) return null;
    throw new CliError(
      "A project id is required. Pass --project-id=<id> or set ORVYQ_PROJECT_ID.",
      "PROJECT_ID_REQUIRED",
    );
  }
  return assertValidProjectId(String(value));
}

function assertIntegerInRange(value, minimum, maximum, label) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new CliError(
      `${label} must be an integer between ${minimum} and ${maximum}; got ${value}`,
      "INVALID_PRODUCTION_PROFILE",
    );
  }
}

export function validateProductionProfile(profile, systemProfile, { requireReady = true } = {}) {
  if (!profile || typeof profile !== "object") {
    throw new CliError("Project production profile must be a JSON object", "INVALID_PRODUCTION_PROFILE");
  }
  assertValidProjectId(profile.project_id);
  if (requireReady && profile.status !== "ready") {
    throw new CliError(
      `Project ${profile.project_id} production profile is not ready (status=${profile.status || "missing"})`,
      "PRODUCTION_PROFILE_NOT_READY",
    );
  }

  const limits = systemProfile?.creative_limits;
  if (!limits) throw new CliError("System creative limits are missing", "INVALID_SYSTEM_PROFILE");

  const systemBalance = limits.visual_medium_balance;
  const projectBalance = profile.visual_medium_balance;
  if (projectBalance && systemBalance) {
    const minimumKeys = [
      "contextual_footage_fraction_min",
      "primary_evidence_fraction_min",
    ];
    const maximumKeys = [
      "contextual_footage_fraction_max",
      "graphic_card_fraction_max",
      "full_screen_text_card_fraction_max",
      "section_graphic_card_fraction_max",
      "maximum_consecutive_graphic_card_shots",
      "maximum_graphic_template_uses",
      "maximum_full_screen_template_uses",
    ];
    for (const key of minimumKeys) {
      if (Number(projectBalance[key]) < Number(systemBalance[key])) {
        throw new CliError(`visual_medium_balance.${key} may only be tightened`, "INVALID_PRODUCTION_PROFILE");
      }
    }
    for (const key of maximumKeys) {
      if (Number(projectBalance[key]) > Number(systemBalance[key])) {
        throw new CliError(`visual_medium_balance.${key} may only be tightened`, "INVALID_PRODUCTION_PROFILE");
      }
    }
    if (Number(projectBalance.contextual_footage_fraction_min) > Number(projectBalance.contextual_footage_fraction_max)) {
      throw new CliError("visual_medium_balance footage minimum exceeds maximum", "INVALID_PRODUCTION_PROFILE");
    }
  }

  const hook = profile.hook || {};
  assertIntegerInRange(
    hook.target_cut_count,
    limits.hook.minimum_cuts,
    limits.hook.maximum_cuts,
    "hook.target_cut_count",
  );
  if (
    !Number.isFinite(Number(hook.target_duration_seconds)) ||
    Number(hook.target_duration_seconds) < limits.hook.minimum_duration_seconds ||
    Number(hook.target_duration_seconds) > limits.hook.maximum_duration_seconds
  ) {
    throw new CliError(
      `hook.target_duration_seconds must be between ${limits.hook.minimum_duration_seconds} and ${limits.hook.maximum_duration_seconds}`,
      "INVALID_PRODUCTION_PROFILE",
    );
  }
  if (limits.hook.human_context_first_required) {
    const hasHumanRole = hook.first_shot_role === "human_context";
    const hasProjectAsset = typeof hook.first_shot_asset === "string" && hook.first_shot_asset.length > 0;
    if (!hasHumanRole && !hasProjectAsset) {
      throw new CliError(
        "hook must declare first_shot_role=human_context or a project-owned first_shot_asset",
        "INVALID_PRODUCTION_PROFILE",
      );
    }
  }

  const rhythm = profile.editorial_rhythm || {};
  const full = Number(rhythm.full_pause_target);
  const brief = Number(rhythm.brief_accent_target);
  if (!Number.isInteger(full) || full < 0 || !Number.isInteger(brief) || brief < 0) {
    throw new CliError(
      "editorial_rhythm targets must be non-negative integers",
      "INVALID_PRODUCTION_PROFILE",
    );
  }
  const total = full + brief;
  if (
    total < limits.editorial_rhythm.minimum_question_beats ||
    total > limits.editorial_rhythm.maximum_question_beats
  ) {
    throw new CliError(
      `editorial question beats must total ${limits.editorial_rhythm.minimum_question_beats}-${limits.editorial_rhythm.maximum_question_beats}; got ${total}`,
      "INVALID_PRODUCTION_PROFILE",
    );
  }

  const evidence = profile.opening_evidence || {};
  if (!limits.opening_evidence.allowed_kinds.includes(evidence.kind)) {
    throw new CliError(
      `opening_evidence.kind must be one of ${limits.opening_evidence.allowed_kinds.join(", ")}`,
      "INVALID_PRODUCTION_PROFILE",
    );
  }
  assertIntegerInRange(
    evidence.target_asset_count,
    limits.opening_evidence.minimum_assets,
    limits.opening_evidence.maximum_assets,
    "opening_evidence.target_asset_count",
  );

  const replacements = profile.creative_polish?.footage_replacements || [];
  if (!Array.isArray(replacements)) {
    throw new CliError("creative_polish.footage_replacements must be an array", "INVALID_PRODUCTION_PROFILE");
  }
  for (const [index, replacement] of replacements.entries()) {
    for (const key of ["shot_id", "asset", "reason"]) {
      if (!replacement?.[key]) {
        throw new CliError(
          `creative_polish.footage_replacements[${index}].${key} is required`,
          "INVALID_PRODUCTION_PROFILE",
        );
      }
    }
  }

  return profile;
}

export async function loadSystemProfile() {
  return readJson(SYSTEM_PROFILE_PATH);
}

export async function loadProjectProductionProfile(projectId) {
  const id = assertValidProjectId(projectId);
  return readJson(path.join(projectDir(id), PROJECT_PROFILE_RELATIVE_PATH));
}

export async function loadProductionPolicy(projectId, options = {}) {
  const [system, project] = await Promise.all([
    loadSystemProfile(),
    loadProjectProductionProfile(projectId),
  ]);
  validateProductionProfile(project, system, options);
  if (project.project_id !== projectId) {
    throw new CliError(
      `Production profile project_id ${project.project_id} does not match requested project ${projectId}`,
      "PROJECT_PROFILE_MISMATCH",
    );
  }
  return {
    system,
    project,
    limits: system.creative_limits,
  };
}
