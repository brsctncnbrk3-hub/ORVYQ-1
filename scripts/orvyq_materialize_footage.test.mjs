import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { validateLocalManifest } from "./orvyq_materialize_footage.mjs";
import { projectDir } from "./lib/fs-utils.mjs";
import { firstReadyProjectId } from "./lib/test-ready-project.mjs";

test("accepts a committed ready project's local footage manifest", async () => {
  const projectId = firstReadyProjectId();
  const manifest = JSON.parse(await readFile(path.join(projectDir(projectId), "assets", "local_assets.json"), "utf8"));
  assert.deepEqual(validateLocalManifest(manifest), []);
  assert.ok(manifest.assets.length > 0);
});

test("rejects unsafe, duplicate, and non-footage paths", () => {
  const failures = validateLocalManifest({
    schema_version: 1,
    assets: [
      { path: "../escape.mp4" },
      { path: "assets/footage/clip.mp4" },
      { path: "assets/footage/clip.mp4" },
      { path: "assets/audio/clip.mp4" }
    ]
  });
  assert.ok(failures.some((failure) => failure.includes("escapes its root")));
  assert.ok(failures.some((failure) => failure.includes("duplicate asset path")));
  assert.ok(failures.some((failure) => failure.includes("must be an MP4 under assets/footage")));
});

test("rejects empty manifests and invalid schema versions", () => {
  assert.deepEqual(validateLocalManifest({ schema_version: 2, assets: [] }), [
    "schema_version must be 1",
    "assets must be a non-empty array"
  ]);
});
