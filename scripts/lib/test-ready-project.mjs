import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./fs-utils.mjs";

export function readyProjectIds() {
  const projectsDir = path.join(REPO_ROOT, "projects");
  if (!fs.existsSync(projectsDir)) return [];
  return fs.readdirSync(projectsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name)
    .filter((projectId) => {
      const profilePath = path.join(projectsDir, projectId, "config", "production_profile.json");
      if (!fs.existsSync(profilePath)) return false;
      const profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
      return profile.project_id === projectId && profile.status === "ready";
    })
    .sort();
}

export function firstReadyProjectId() {
  const ids = readyProjectIds();
  if (!ids.length) throw new Error("Integration test requires at least one project with production_profile.status=ready");
  return ids[0];
}
