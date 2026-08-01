#!/usr/bin/env node
// Instruction-leak gate (task section 4.4 / 8.2). Two independent checks
// against every viewer-facing text field on every shot in
// direction/edit_plan.json:
//
//  (1) exact/substring match against a real, known internal instruction --
//      every claim's own research/evidence_map.json evidence_requirements[]
//      string, plus the literal example strings the rejected review
//      (run 30132412035) is confirmed to have leaked to screen.
//  (2) a generic imperative-instruction pattern match (task section 8.2's
//      own list: "show...", "do not...", "no decorative...", "use
//      official...", "display...", "avoid...", "editor note...",
//      "production note...", "source handling...", "replace with...",
//      "insert footage...") -- catches a leaked instruction whose exact
//      text this project has never seen before, not just the known
//      regression fixtures.
//
// scripts/lib/orvyq-evidence-authoring.mjs's DISPLAYABLE_FACT_TYPES
// allowlist is the real fix (requirement facts can no longer reach these
// fields at all); this audit is the independent, build-time check that
// verifies that fix actually holds against the real generated plan, and
// will catch any other future path that accidentally reintroduces a leak.
import path from "node:path";
import { projectDir, readJson, writeJsonAtomic, parseArgs, printJson } from "./lib/fs-utils.mjs";
import { loadResolvedEvidenceMap } from "./lib/orvyq-evidence.mjs";

const PROJECT_ID = process.env.ORVYQ_PROJECT_ID || null;

// Imperative production-instruction phrasing (task section 8.2's own list).
// Case-insensitive, matched anywhere in a visible string, not just at its
// start -- a leaked instruction is often embedded mid-sentence.
const INSTRUCTION_PATTERNS = [
  /\bshow\s+(the\s+)?(official|real|source)\b/i,
  /\bdo\s+not\s+(show|imply|use|display)\b/i,
  /\bno\s+decorative\b/i,
  /\buse\s+official\b/i,
  /\bdisplay\s+the\b/i,
  /\bavoid\s+(using|showing|implying)\b/i,
  /\bedit(or|orial)?\s*note\s*:/i,
  /\binternal\s+note\s*:/i,
  /\bproduction\s+note\s*:/i,
  /\bsource\s+handling\b/i,
  /\breplace\s+with\b/i,
  /\binsert\s+footage\b/i
];

// Every viewer-facing string a shot can ever place on screen. Kept
// deliberately explicit (an allowlist of FIELDS, not a blind
// JSON.stringify) so a future internal-only field added to a shot spec
// (e.g. an editorial_purpose or reuse_reason, both authoring metadata, not
// rendered) is never accidentally scanned as if it were displayed, and so a
// truly new displayed field must be added here on purpose.
function visibleStringsOf(shot) {
  const strings = [];
  const push = (value) => {
    if (typeof value === "string" && value.trim()) strings.push(value);
  };
  if (shot.asset_type === "graphic" && shot.graphic) {
    push(shot.graphic.kicker);
    push(shot.graphic.title);
    push(shot.graphic.subtitle);
    for (const label of shot.graphic.labels || []) push(label);
  }
  if (shot.asset_type === "evidence" && shot.evidence) {
    const e = shot.evidence;
    push(e.eyebrow);
    push(e.title);
    push(e.limitation);
    push(e.source_label);
    push(e.left);
    push(e.left_detail);
    push(e.right);
    push(e.right_detail);
    for (const item of e.items || []) {
      push(item.label);
      push(item.value);
      push(item.detail);
    }
    for (const step of e.steps || []) push(step);
  }
  if (shot.emphasis_card) {
    push(shot.emphasis_card.eyebrow);
    push(shot.emphasis_card.title);
  }
  if (shot.text_overlay) push(shot.text_overlay);
  return strings;
}

export function auditLeakedInstructions(shots, rawInstructionStrings) {
  const failures = [];
  const warnings = [];
  const normalizedInstructions = rawInstructionStrings.map((s) => String(s).trim().toLowerCase()).filter((s) => s.length > 0);

  for (const shot of shots) {
    for (const text of visibleStringsOf(shot)) {
      const normalized = text.trim().toLowerCase();
      for (const instruction of normalizedInstructions) {
        if (instruction.length >= 8 && normalized.includes(instruction)) {
          failures.push(`${shot.shot_id || shot.claim_id || "(shot)"} displays a raw internal instruction string: "${text}"`);
        }
      }
      for (const pattern of INSTRUCTION_PATTERNS) {
        if (pattern.test(text)) {
          failures.push(`${shot.shot_id || shot.claim_id || "(shot)"} displays text matching an imperative-instruction pattern (${pattern}): "${text}"`);
        }
      }
    }
  }

  return { shots_scanned: shots.length, instruction_strings_checked: normalizedInstructions.length, failures, warnings };
}

export async function runLeakedInstructionAudit(projectId = PROJECT_ID) {
  const dir = projectDir(projectId);
  const [plan, evidenceMap] = await Promise.all([readJson(path.join(dir, "direction", "edit_plan.json")), loadResolvedEvidenceMap(dir)]);
  const rawInstructionStrings = evidenceMap.claims.flatMap((claim) => claim.evidence_requirements || []);
  const result = auditLeakedInstructions(plan.shots, rawInstructionStrings);
  const report = { schema_version: "1.0-canonical", project_id: projectId, ...result, pass: result.failures.length === 0 };
  await writeJsonAtomic(path.join(dir, "qa", "leaked_instruction_audit.json"), report);
  if (!report.pass) throw new Error(`ORVYQ leaked-instruction audit failed: ${result.failures.join("; ")}`);
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  runLeakedInstructionAudit(args["project-id"] || PROJECT_ID)
    .then((report) => printJson({ ok: true, ...report }))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
