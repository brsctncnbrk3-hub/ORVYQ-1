#!/usr/bin/env node
// Historical filename retained so existing workflows remain dispatchable.
// This is now a network-free validator for footage committed to ORVYQ itself.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  projectDir,
  readJson,
  writeJsonAtomic,
  pathExists,
  parseArgs,
  printJson
} from "./lib/fs-utils.mjs";

const PROJECT_ID = process.env.ORVYQ_PROJECT_ID || null;

function safeRelative(value, label) {
  if (!value || typeof value !== "string" || path.isAbsolute(value) || value.includes("\\"))
    throw new Error(`${label} must be a non-empty POSIX relative path`);
  const normalized = path.posix.normalize(value);
  if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../"))
    throw new Error(`${label} escapes its root: ${value}`);
  return normalized;
}

export function validateLocalManifest(manifest) {
  const failures = [];
  if (manifest.schema_version !== 1) failures.push("schema_version must be 1");
  if (!Array.isArray(manifest.assets) || manifest.assets.length === 0)
    failures.push("assets must be a non-empty array");
  const paths = new Set();
  for (const [index, item] of (manifest.assets || []).entries()) {
    try {
      const assetPath = safeRelative(item.path, `assets[${index}].path`);
      if (!assetPath.startsWith("assets/footage/") || !assetPath.endsWith(".mp4"))
        failures.push(`assets[${index}].path must be an MP4 under assets/footage`);
      if (paths.has(assetPath)) failures.push(`duplicate asset path ${assetPath}`);
      paths.add(assetPath);
    } catch (error) {
      failures.push(String(error.message || error));
    }
  }
  return failures;
}

async function sha256File(absPath) {
  const buffer = await readFile(absPath);
  return createHash("sha256").update(buffer).digest("hex");
}

export async function validateLocalFootage(projectId = PROJECT_ID) {
  const dir = projectDir(projectId);
  const manifestFile = path.join(dir, "assets", "local_assets.json");
  if (!(await pathExists(manifestFile)))
    throw new Error(`Local asset manifest is missing: ${manifestFile}`);

  const manifest = await readJson(manifestFile);
  const manifestFailures = validateLocalManifest(manifest);
  if (manifestFailures.length)
    throw new Error(`Invalid local asset manifest:\n- ${manifestFailures.join("\n- ")}`);

  const records = [];
  const failures = [];
  for (const item of manifest.assets) {
    const relativePath = safeRelative(item.path, "asset path");
    const assetPath = path.join(dir, relativePath);
    const provenancePath = `${assetPath}.provenance.json`;
    if (!(await pathExists(assetPath))) {
      failures.push(`${relativePath}: media file is missing`);
      continue;
    }
    if (!(await pathExists(provenancePath))) {
      failures.push(`${relativePath}: provenance file is missing`);
      continue;
    }

    const provenance = await readJson(provenancePath);
    const bytes = (await readFile(assetPath)).byteLength;
    const digest = await sha256File(assetPath);
    const expectedHash = String(provenance.sha256 || provenance.actual_sha256 || "").toLowerCase();
    const expectedBytes = Number(provenance.byte_size);
    if (!/^[a-f0-9]{64}$/.test(expectedHash))
      failures.push(`${relativePath}: provenance has no valid SHA-256`);
    else if (digest !== expectedHash)
      failures.push(`${relativePath}: SHA-256 ${digest} != provenance ${expectedHash}`);
    if (!Number.isFinite(expectedBytes))
      failures.push(`${relativePath}: provenance has no valid byte_size`);
    else if (bytes !== expectedBytes)
      failures.push(`${relativePath}: size ${bytes} != provenance ${expectedBytes}`);
    if (provenance.approved_for_final_edit !== true)
      failures.push(`${relativePath}: provenance is not approved_for_final_edit`);

    records.push({
      path: relativePath,
      provenance_path: `${relativePath}.provenance.json`,
      sha256: digest,
      size_bytes: bytes,
      provider: provenance.provider,
      provider_asset_id: provenance.provider_asset_id,
      approved_for_final_edit: provenance.approved_for_final_edit === true
    });
  }
  if (failures.length)
    throw new Error(`Local footage validation failed:\n- ${failures.join("\n- ")}`);

  await writeJsonAtomic(path.join(dir, "qa", "local_assets.provenance.json"), {
    schema_version: 1,
    project_id: projectId,
    generated_at: new Date().toISOString(),
    records
  });
  console.log(`Validated ${records.length} local footage files with no external repository access`);
  return { validated: records.length };
}

const isMain = process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  validateLocalFootage(args["project-id"] || PROJECT_ID)
    .then((result) => printJson({ ok: true, ...result }))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}
