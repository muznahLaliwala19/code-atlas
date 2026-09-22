import path from "path";
import { walkProject } from "./walk.js";
import { detectTechnologies } from "./detect-technologies.js";
import { detectDatabases } from "./detect-database.js";
import { detectApis } from "./detect-apis.js";
import { detectModules } from "./detect-modules.js";

/**
 * Full project analysis → CodeAtlas report contract.
 */
export async function analyzeProject(rootDir, options = {}) {
  const projectName =
    options.projectName ||
    path.basename(rootDir).replace(/\.zip$/i, "") ||
    "project";

  const started = Date.now();
  const { files, stats } = await walkProject(rootDir);

  const tech = detectTechnologies(files);
  const database = detectDatabases(files, tech.packages);
  const apis = detectApis(files);
  const modules = detectModules(files, tech.packages);

  // Remove npm: noise already handled; strip TypeScript from frameworks if listed as language only via dep
  const frameworks = tech.frameworks.filter((f) => f !== "TypeScript");

  return {
    projectName,
    technologies: {
      languages: tech.languages,
      frameworks,
      others: tech.others,
    },
    modules: {
      packages: modules.packages,
      internal: modules.internal,
    },
    apis: apis.map(({ method, path: p, file, name }) => ({
      method,
      path: p,
      file,
      ...(name ? { name } : {}),
    })),
    database: database.map((d) => ({
      name: d.name,
      orm: d.orm,
      evidence: d.evidence,
    })),
    meta: {
      scannedFiles: stats.fileCount,
      totalBytes: stats.totalBytes,
      capped: stats.capped,
      durationMs: Date.now() - started,
      skippedHeavyDirs: stats.skippedDirs,
    },
  };
}
