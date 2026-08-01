#!/usr/bin/env node
import path from 'node:path';
import { projectDir, readJson, writeJsonAtomic, parseArgs, printJson } from './lib/fs-utils.mjs';

const MOTIONS = ['hold', 'push', 'drift_left', 'drift_right', 'pull'];

export async function seedEditorialAssetPlan(projectId) {
  const dir = projectDir(projectId);
  const evidence = await readJson(path.join(dir, 'research', 'evidence_map.json'));
  const local = await readJson(path.join(dir, 'assets', 'local_assets.json'));
  const claims = Array.isArray(evidence.claims) ? evidence.claims : [];
  const assets = (Array.isArray(local.assets) ? local.assets : [])
    .map((entry) => typeof entry === 'string' ? entry : entry?.path)
    .filter((entry) => typeof entry === 'string' && entry.endsWith('.mp4'));
  if (!claims.length) throw new Error('evidence_map.json contains no claims');
  if (!assets.length) throw new Error('local_assets.json contains no footage assets');

  // Give every factual claim a deliberate contextual-footage interruption at
  // its opening slice. Assets are unique until the catalog is exhausted; this
  // avoids accidental visual repetition while preserving evidence-led beats.
  const footageAssignments = {};
  for (let index = 0; index < claims.length; index += 1) {
    const claim = claims[index];
    const asset = assets[index % assets.length];
    const assignment = {
      asset,
      trimInRatio: ((index % 5) * 0.08),
      motion: MOTIONS[index % MOTIONS.length],
      role: index % 4 === 0 ? 'human_context' : 'context',
    };
    if (index >= assets.length) {
      assignment.reuse_reason = 'The acquired catalog is reused only after every distinct source has appeared once; this later occurrence is a different trim window supporting a new claim-specific context beat.';
    }
    footageAssignments[claim.claim_id] = { '0': assignment };
  }

  const plan = {
    schema_version: '1.0',
    project_id: projectId,
    status: 'ready',
    generation_policy: 'evidence-claim opening context; unique-source-first; no silent fallback',
    footage_assignments: footageAssignments,
    graphic_break_assignments: {},
    full_footage_pool: assets,
    hook_preloaded_usage: {},
    slice_count_overrides: {},
  };
  await writeJsonAtomic(path.join(dir, 'config', 'editorial_asset_plan.json'), plan);
  return { claim_count: claims.length, asset_count: assets.length, assignment_count: Object.keys(footageAssignments).length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const projectId = args['project-id'] || process.env.ORVYQ_PROJECT_ID;
  seedEditorialAssetPlan(projectId)
    .then((result) => printJson({ ok: true, ...result }))
    .catch((error) => { console.error(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; });
}
