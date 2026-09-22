/**
 * Infer request/layer architecture from real folders in the zip.
 * Never invents layers that are not present on disk.
 */
import fs from "fs/promises";
import path from "path";
import { IGNORE_DIRS } from "../scanner/constants.js";

async function readDirSafe(dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function shouldSkipDir(name) {
  if (!name || name.startsWith(".")) return true;
  if (IGNORE_DIRS.has(name)) return true;
  return ["node_modules", "coverage", "dist", "build", ".git", ".idea"].includes(
    name.toLowerCase()
  );
}

async function hasAppMarker(dir) {
  const kids = await readDirSafe(dir);
  return kids.some(
    (e) =>
      e.isFile() &&
      (/^(package\.json|pubspec\.yaml|server\.js|app\.js|main\.py|manage\.py)$/i.test(e.name) ||
        /\.(csproj|fsproj|vbproj)$/i.test(e.name))
  );
}

async function resolveAppRoot(extractRoot) {
  if (await hasAppMarker(extractRoot)) {
    return extractRoot;
  }
  const entries = await readDirSafe(extractRoot);
  const dirs = entries.filter((e) => e.isDirectory() && !shouldSkipDir(e.name));
  if (dirs.length === 1) {
    const child = path.join(extractRoot, dirs[0].name);
    if (await hasAppMarker(child)) return child;
  }
  for (const d of dirs) {
    const child = path.join(extractRoot, d.name);
    if (await hasAppMarker(child)) return child;
  }
  return extractRoot;
}

async function collectFolderNames(rootAbs, maxDepth = 3) {
  const names = new Set();
  async function walk(abs, depth) {
    if (depth > maxDepth) return;
    for (const e of await readDirSafe(abs)) {
      if (!e.isDirectory() || shouldSkipDir(e.name)) continue;
      names.add(e.name.toLowerCase());
      await walk(path.join(abs, e.name), depth + 1);
    }
  }
  await walk(rootAbs, 0);
  return names;
}

function hasAny(names, list) {
  return list.some((n) => names.has(n));
}

/**
 * Pick the best architecture template that matches folder evidence.
 * Returns null when fewer than 2 layers are proven.
 */
function matchArchitecture(names) {
  const candidates = [];

  // Express / Nest / typical Node API
  {
    const layers = [];
    if (hasAny(names, ["routes", "routers", "api"])) layers.push({ key: "route", label: "Route" });
    if (hasAny(names, ["middleware", "middlewares"])) layers.push({ key: "middleware", label: "Middleware" });
    if (hasAny(names, ["controllers", "handlers"])) layers.push({ key: "controller", label: "Controller" });
    if (hasAny(names, ["services", "service"])) layers.push({ key: "service", label: "Service" });
    if (hasAny(names, ["config", "db", "database", "models", "repositories", "repository", "data"])) {
      layers.push({ key: "database", label: "Database" });
    }
    if (layers.length >= 2) {
      candidates.push({
        style: "node-api",
        score: layers.length * 10 + (hasAny(names, ["routes", "controllers"]) ? 5 : 0),
        layers,
        pattern: [...layers.map((l) => l.label), "Response"].join(" → "),
      });
    }
  }

  // ASP.NET MVC / Web API
  {
    const layers = [];
    if (hasAny(names, ["controllers"])) layers.push({ key: "controller", label: "Controller" });
    if (hasAny(names, ["views", "pages"])) layers.push({ key: "view", label: "View / Page" });
    if (hasAny(names, ["services", "service", "repositories", "repository", "infrastructure"])) {
      layers.push({ key: "service", label: "Service / Repository" });
    }
    if (hasAny(names, ["models", "entities", "data", "dbcontext"])) {
      layers.push({ key: "database", label: "Database" });
    }
    if (layers.length >= 2) {
      candidates.push({
        style: "dotnet-mvc",
        score: layers.length * 10 + (hasAny(names, ["controllers", "views"]) ? 8 : 0),
        layers,
        pattern: [...layers.map((l) => l.label), "Response"].join(" → "),
      });
    }
  }

  // Flutter / mobile feature apps
  {
    const layers = [];
    if (hasAny(names, ["screens", "screen", "pages", "ui", "presentation", "features"])) {
      layers.push({ key: "ui", label: "UI screen" });
    }
    if (hasAny(names, ["bloc", "blocs", "cubit", "provider", "providers", "viewmodel", "viewmodels"])) {
      layers.push({ key: "state", label: "State / bloc" });
    }
    if (hasAny(names, ["repository", "repositories", "data", "network", "api", "services"])) {
      layers.push({ key: "data", label: "API / repository" });
    }
    if (layers.length >= 2) {
      candidates.push({
        style: "flutter",
        score: layers.length * 10 + (hasAny(names, ["screens", "features"]) ? 6 : 0),
        layers,
        pattern: layers.map((l) => l.label).join(" → "),
      });
    }
  }

  // Next.js / React app router
  {
    const layers = [];
    if (hasAny(names, ["app", "pages"])) layers.push({ key: "page", label: "Page / route" });
    if (hasAny(names, ["api"])) layers.push({ key: "api", label: "API route" });
    if (hasAny(names, ["lib", "utils", "services", "server"])) {
      layers.push({ key: "lib", label: "Lib / service" });
    }
    if (hasAny(names, ["prisma", "drizzle", "models", "db"])) {
      layers.push({ key: "database", label: "Database / ORM" });
    }
    if (layers.length >= 2) {
      candidates.push({
        style: "next",
        score: layers.length * 9 + (hasAny(names, ["app", "pages"]) ? 4 : 0),
        layers,
        pattern: [...layers.map((l) => l.label), "Response"].join(" → "),
      });
    }
  }

  // Django / Flask / FastAPI
  {
    const layers = [];
    if (hasAny(names, ["urls", "routes", "routers"])) layers.push({ key: "route", label: "URL / route" });
    if (hasAny(names, ["views", "viewsets", "api", "handlers"])) {
      layers.push({ key: "view", label: "View / endpoint" });
    }
    if (hasAny(names, ["services", "service"])) layers.push({ key: "service", label: "Service" });
    if (hasAny(names, ["models", "serializers", "schema", "db"])) {
      layers.push({ key: "model", label: "Model / DB" });
    }
    if (layers.length >= 2) {
      candidates.push({
        style: "python-web",
        score: layers.length * 10 + (hasAny(names, ["views", "models"]) ? 5 : 0),
        layers,
        pattern: [...layers.map((l) => l.label), "Response"].join(" → "),
      });
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0];
}

/**
 * @returns {{ pattern: string, layers: string[], style: string, note: string } | null}
 */
export async function detectArchitectureFromDisk(extractRoot) {
  const appRoot = await resolveAppRoot(extractRoot);
  const names = await collectFolderNames(appRoot, 3);
  const hit = matchArchitecture(names);
  if (!hit) {
    return {
      pattern: null,
      layers: [],
      style: "unknown",
      note: "Not enough folder signals to infer architecture — no invented layers.",
    };
  }
  return {
    pattern: hit.pattern,
    layers: hit.layers.map((l) => l.label),
    style: hit.style,
    note: "Inferred from folders present in this project zip only.",
  };
}
