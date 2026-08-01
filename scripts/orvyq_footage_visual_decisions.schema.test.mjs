import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadCanonicalAjv, readJson } from "./lib/schema-validate.mjs";
import {
  validateLocalFootage,
  reconcileActiveLocalFootage,
} from "./orvyq_validate_local_footage.mjs";

test("Project 002 byte-bound footage visual decision rounds satisfy their schema", () => {
  const ajv = loadCanonicalAjv();
  const validate = ajv.getSchema("footage_visual_decisions.schema.json");
  assert.ok(validate, "footage visual decision schema must be registered");
  const researchDir = path.resolve("projects/002-the-new-war-beneath-the-ocean/research");
  const files = fs.readdirSync(researchDir)
    .filter((name) => /^footage_visual_decisions(?:_[a-z0-9-]+)?\.json$/.test(name))
    .sort();
  assert.ok(files.length >= 1, "at least one footage visual decision round is required");
  for (const file of files) {
    const decisions = readJson(path.join(researchDir, file));
    assert.equal(validate(decisions), true, `${file}: ${JSON.stringify(validate.errors)}`);
    assert.ok(decisions.decisions.length > 0, `${file} must contain decisions`);
    assert.equal(
      new Set(decisions.decisions.map((item) => item.scene_id)).size,
      decisions.decisions.length,
      `${file} must not contain duplicate scene decisions`,
    );
  }
});

test("local-footage validation and active-manifest reconciliation entrypoints remain callable", () => {
  assert.equal(typeof validateLocalFootage, "function");
  assert.equal(typeof reconcileActiveLocalFootage, "function");
});
