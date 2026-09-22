import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_ROOT = path.join(__dirname, "..", "..", "data", "projects");

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export function projectDir(projectId) {
  return path.join(DATA_ROOT, projectId);
}

export async function saveProjectRecord(projectId, record) {
  const dir = projectDir(projectId);
  await ensureDir(dir);
  const file = path.join(dir, "project.json");
  await fs.writeFile(file, JSON.stringify(record, null, 2), "utf8");
  return file;
}

export async function loadProjectRecord(projectId) {
  const file = path.join(projectDir(projectId), "project.json");
  const raw = await fs.readFile(file, "utf8");
  return JSON.parse(raw);
}

export async function updateProjectRecord(projectId, patch) {
  const current = await loadProjectRecord(projectId);
  const next = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  // deep-ish merge for nested maps
  if (patch.moduleExplanations || current.moduleExplanations) {
    next.moduleExplanations = {
      ...(current.moduleExplanations || {}),
      ...(patch.moduleExplanations || {}),
    };
  }
  if (patch.overview) {
    next.overview = patch.overview;
  }
  if (patch.databaseAnalysis !== undefined) {
    next.databaseAnalysis = patch.databaseAnalysis;
  }
  await saveProjectRecord(projectId, next);
  return next;
}

export async function saveExtractPath(projectId, extractRoot) {
  const dir = projectDir(projectId);
  await ensureDir(dir);
  await fs.writeFile(
    path.join(dir, "extract-path.json"),
    JSON.stringify({ extractRoot, savedAt: new Date().toISOString() }, null, 2),
    "utf8"
  );
}

export async function loadExtractPath(projectId) {
  try {
    const raw = await fs.readFile(path.join(projectDir(projectId), "extract-path.json"), "utf8");
    return JSON.parse(raw).extractRoot;
  } catch {
    return null;
  }
}
