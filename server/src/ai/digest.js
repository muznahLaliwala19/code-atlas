import fs from "fs/promises";
import path from "path";
import {
  IGNORE_DIRS,
  SCAN_EXTENSIONS,
  MAX_FILE_BYTES,
} from "../scanner/constants.js";

const PRIORITY_NAMES = new Set([
  "package.json",
  "pubspec.yaml",
  "requirements.txt",
  "pyproject.toml",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "composer.json",
  "go.mod",
  "Cargo.toml",
  "Gemfile",
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "schema.prisma",
  "endpoints.dart",
  "openapi.yaml",
  "openapi.json",
  "swagger.json",
  "README.md",
  "readme.md",
  ".env.example",
  "appsettings.json",
]);

const MAX_DIGEST_CHARS = 220_000;
const MAX_FILE_CHARS = 12_000;
const MAX_ENDPOINT_FILE_CHARS = 120_000;

function shouldIgnoreDir(name) {
  return (
    IGNORE_DIRS.has(name) ||
    (name.startsWith(".") && name !== ".github" && name !== ".env")
  );
}

async function walkAllFiles(rootDir) {
  const out = [];
  async function walk(abs, rel) {
    let entries;
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const name = entry.name;
      const childAbs = path.join(abs, name);
      const childRel = rel ? `${rel}/${name}` : name;
      const norm = childRel.replace(/\\/g, "/");

      if (entry.isDirectory()) {
        if (shouldIgnoreDir(name)) continue;
        await walk(childAbs, childRel);
        continue;
      }
      if (!entry.isFile()) continue;
      out.push({ abs: childAbs, rel: norm, base: name, ext: path.extname(name).toLowerCase() });
    }
  }
  await walk(rootDir, "");
  return out;
}

/**
 * Walk project and build a text digest for the AI.
 */
export async function buildProjectDigest(rootDir) {
  const tree = [];
  const files = [];
  let totalFiles = 0;

  async function walk(abs, rel) {
    let entries;
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const name = entry.name;
      const childAbs = path.join(abs, name);
      const childRel = rel ? `${rel}/${name}` : name;
      const norm = childRel.replace(/\\/g, "/");

      if (entry.isDirectory()) {
        if (shouldIgnoreDir(name)) continue;
        tree.push(norm + "/");
        await walk(childAbs, childRel);
        continue;
      }
      if (!entry.isFile()) continue;
      totalFiles += 1;
      tree.push(norm);

      const ext = path.extname(name).toLowerCase();
      const important = PRIORITY_NAMES.has(name) || /endpoint/i.test(name);
      if (!important && !SCAN_EXTENSIONS.has(ext)) continue;

      let st;
      try {
        st = await fs.stat(childAbs);
      } catch {
        continue;
      }
      if (st.size === 0 || st.size > MAX_FILE_BYTES * 2) continue;

      let content = "";
      try {
        content = await fs.readFile(childAbs, "utf8");
      } catch {
        continue;
      }
      if (!content || content.includes("\u0000")) continue;
      const limit =
        /endpoint/i.test(name) || PRIORITY_NAMES.has(name)
          ? MAX_ENDPOINT_FILE_CHARS
          : MAX_FILE_CHARS;
      if (content.length > limit) {
        content = content.slice(0, limit) + "\n/* …truncated… */\n";
      }
      files.push({
        path: norm,
        priority: /endpoint/i.test(name) ? -1 : important ? 0 : 1,
        content,
      });
    }
  }

  await walk(rootDir, "");
  files.sort((a, b) => a.priority - b.priority || a.path.localeCompare(b.path));

  const treeText = tree.slice(0, 4000).join("\n");
  let digest = `PROJECT_ROOT: ${path.basename(rootDir)}\nTOTAL_FILES_SEEN: ${totalFiles}\n\n=== FILE TREE ===\n${treeText}\n\n=== FILE CONTENTS ===\n`;

  for (const f of files) {
    const block = `\n--- FILE: ${f.path} ---\n${f.content}\n`;
    if (digest.length + block.length > MAX_DIGEST_CHARS) break;
    digest += block;
  }

  return {
    digest,
    stats: {
      totalFiles,
      treeEntries: tree.length,
      includedFiles: files.length,
      digestChars: digest.length,
    },
  };
}

export async function buildModuleDigest(rootDir, moduleName) {
  const { digest, stats } = await buildProjectDigest(rootDir);
  const lines = digest.split("\n");
  const needle = moduleName.toLowerCase();
  const relevant = [];
  let keep = false;
  let current = [];
  for (const line of lines) {
    if (line.startsWith("--- FILE:")) {
      if (current.length && keep) relevant.push(current.join("\n"));
      current = [line];
      keep = line.toLowerCase().includes(needle);
      continue;
    }
    current.push(line);
  }
  if (current.length && keep) relevant.push(current.join("\n"));

  const focused =
    relevant.length > 0
      ? `MODULE: ${moduleName}\n\n${relevant.join("\n\n").slice(0, MAX_DIGEST_CHARS)}`
      : `MODULE: ${moduleName}\n\n(No exact path match — use full project context)\n\n${digest.slice(0, 80_000)}`;

  return { digest: focused, stats };
}

function isEndpointCatalogFile(base, norm) {
  if (/endpoint/i.test(base)) return true;
  if (/openapi|swagger/i.test(base)) return true;
  if (/\.(yaml|yml|json)$/i.test(base) && /api|route|swagger|openapi/i.test(norm)) return true;
  return false;
}

/**
 * Prefer endpoint *catalog* files (endpoints.dart), not every api.dart call site.
 */
export async function buildApiDigest(rootDir) {
  const all = await walkAllFiles(rootDir);
  const catalog = [];
  const secondary = [];

  for (const f of all) {
    if (isEndpointCatalogFile(f.base, f.rel)) {
      catalog.push(f);
    } else if (
      /(^|\/)routes?\.(js|ts|py|rb|php)$/i.test(f.rel) ||
      f.base === "urls.py" ||
      f.base === "web.php" ||
      f.base.endsWith("Controller.cs")
    ) {
      secondary.push(f);
    }
  }

  const selected = [...catalog, ...secondary];
  const files = [];
  for (const f of selected) {
    let content = "";
    try {
      content = await fs.readFile(f.abs, "utf8");
    } catch {
      continue;
    }
    if (!content || content.includes("\u0000")) continue;
    if (content.length > MAX_ENDPOINT_FILE_CHARS) {
      content = content.slice(0, MAX_ENDPOINT_FILE_CHARS) + "\n/* …truncated… */\n";
    }
    files.push({ path: f.rel, content });
  }

  let digest = `API CATALOG FILES (${files.length})\n`;
  for (const f of files) {
    const block = `\n--- FILE: ${f.path} ---\n${f.content}\n`;
    if (digest.length + block.length > MAX_DIGEST_CHARS) break;
    digest += block;
  }

  return {
    digest,
    files,
    stats: {
      totalFiles: all.length,
      includedFiles: files.length,
      digestChars: digest.length,
    },
  };
}

/**
 * Load endpoint catalog files from disk and extract APIs (no digest truncation).
 */
function joinAspNetRoutes(baseRoute, actionRoute) {
  const base = String(baseRoute || "").trim();
  const action = String(actionRoute || "").trim();
  if (!base && !action) return "/";
  if (!base) return action.startsWith("/") ? action : `/${action}`;
  if (!action) return base.startsWith("/") ? base : `/${base}`;
  const b = base.replace(/\/+$/, "");
  const a = action.replace(/^\/+/, "");
  return `${b}/${a}`.replace(/\/{2,}/g, "/");
}

/**
 * Deterministic ASP.NET Core API extract from Controllers + Program.cs (additive).
 */
export async function collectAspNetApisFromDisk(rootDir) {
  const all = await walkAllFiles(rootDir);
  const apis = [];

  for (const f of all) {
    const isController = /Controller\.cs$/i.test(f.base);
    const isProgram = /^program\.cs$/i.test(f.base);
    if (!isController && !isProgram) continue;

    let content = "";
    try {
      content = await fs.readFile(f.abs, "utf8");
    } catch {
      continue;
    }
    if (!content) continue;

    let classRoute = "";
    const routeMatch = content.match(/\[Route\s*\(\s*['"`]([^'"`]+)['"`]\s*\)\]/i);
    if (routeMatch) classRoute = routeMatch[1];

    for (const m of content.matchAll(
      /\[Http(Get|Post|Put|Patch|Delete|Head|Options)(?:\s*\(\s*['"`]([^'"`]*)['"`]\s*\))?\]/gi
    )) {
      const method = m[1].toUpperCase();
      const actionPath = m[2] ?? "";
      const pathStr = joinAspNetRoutes(classRoute, actionPath);
      const name = f.base.replace(/Controller\.cs$/i, "");
      apis.push({
        method,
        path: pathStr,
        file: f.rel,
        name: name || pathStr,
      });
    }

    for (const m of content.matchAll(
      /\.Map(Get|Post|Put|Patch|Delete|Methods)\s*\(\s*['"`]([^'"`]+)['"`]/gi
    )) {
      apis.push({
        method: m[1].toUpperCase(),
        path: m[2].startsWith("/") ? m[2] : `/${m[2]}`,
        file: f.rel,
        name: m[2],
      });
    }

    for (const m of content.matchAll(
      /\[Route\s*\(\s*['"`]([^'"`]+)['"`]\s*\)\]/gi
    )) {
      if (isController) continue;
      const pathStr = m[1].startsWith("/") ? m[1] : `/${m[1]}`;
      apis.push({
        method: "ALL",
        path: pathStr,
        file: f.rel,
        name: pathStr,
      });
    }
  }

  const byKey = new Map();
  for (const a of apis) {
    const key = `${a.method}|${a.path}|${a.file}`;
    if (!byKey.has(key)) byKey.set(key, a);
  }
  return [...byKey.values()].sort((a, b) => String(a.path).localeCompare(String(b.path)));
}

export async function collectEndpointApisFromDisk(rootDir) {
  const all = await walkAllFiles(rootDir);
  const blocks = [];
  for (const f of all) {
    if (!isEndpointCatalogFile(f.base, f.rel) && f.ext !== ".dart") continue;
    // For dart: only catalogs / constants with Endpoints class — not every screen
    if (f.ext === ".dart" && !/endpoint/i.test(f.base) && !/constant/i.test(f.rel)) continue;
    if (f.ext === ".dart" && !/endpoint/i.test(f.base) && !/network/i.test(f.rel)) continue;

    let content = "";
    try {
      content = await fs.readFile(f.abs, "utf8");
    } catch {
      continue;
    }
    if (!content) continue;
    if (/endpoint/i.test(f.base) || /class\s+Endpoints\b/.test(content)) {
      blocks.push({ path: f.rel, content });
    }
  }

  return extractDartEndpointApis(blocks);
}

/**
 * Deterministic extract from Flutter/Dart Endpoints-style constants.
 */
export function extractDartEndpointApis(filesContent) {
  const apis = [];
  const skip = new Set([
    "baseurl",
    "imgurl",
    "imageurl",
    "receivetimeout",
    "connectiontimeout",
    "connecttimeout",
    "islive",
    "appversionandroid",
    "appversionios",
    "playstoreurl",
    "appstoreurl",
    "privacypolicyurl",
    "filedownloadurl",
    "reportfiledownloadurl",
  ]);

  for (const f of filesContent) {
    const consts = new Map();
    // Match both simple and ternary-assigned strings later for path consts
    const re =
      /(?:static\s+)?(?:const\s+)?String\s+(\w+)\s*=\s*(?:r)?(['"])([\s\S]*?)\2\s*;/g;
    let m;
    while ((m = re.exec(f.content)) !== null) {
      consts.set(m[1], m[3].replace(/\s+/g, ""));
    }

    // Also catch: static const String x = '${baseUrl}Foo'; with possible whitespace
    const re2 =
      /(?:static\s+)?(?:const\s+)?String\s+(\w+)\s*=\s*'([^']*)'\s*;/g;
    while ((m = re2.exec(f.content)) !== null) {
      if (!consts.has(m[1])) consts.set(m[1], m[2].replace(/\s+/g, ""));
    }
    const re3 =
      /(?:static\s+)?(?:const\s+)?String\s+(\w+)\s*=\s*"([^"]*)"\s*;/g;
    while ((m = re3.exec(f.content)) !== null) {
      if (!consts.has(m[1])) consts.set(m[1], m[2].replace(/\s+/g, ""));
    }

    const resolve = (raw) =>
      raw
        .replace(/\$\{(\w+)\}/g, (_, n) => consts.get(n) || "")
        .replace(/\$(\w+)/g, (_, n) => consts.get(n) || "");

    for (const [name, raw] of consts) {
      if (skip.has(name.toLowerCase())) continue;
      const usesBase =
        /\$\{?baseUrl\}?/i.test(raw) ||
        /\$\{?apiUrl\}?/i.test(raw) ||
        /\$\{?API_URL\}?/i.test(raw);
      const isHttp = /https?:\/\//i.test(raw);
      // Path-looking relative segments even without baseUrl resolved
      const looksLikeRoute =
        usesBase ||
        isHttp ||
        (/^[A-Za-z][\w]*\/[\w\-./]+/.test(raw) && !/\s/.test(raw));

      if (!looksLikeRoute && !usesBase && !isHttp) continue;
      if (
        /timeout|version|policy|store/i.test(name) &&
        !/api|list|get|login|otp|report/i.test(name)
      ) {
        continue;
      }

      let resolved = resolve(raw);
      // If baseUrl missing from consts (ternary), keep path after interpolation removal
      if (!resolved) continue;
      if (/^https?:\/\/[^/]+\/?$/i.test(resolved)) continue;

      let pathStr = resolved;
      if (/^https?:\/\//i.test(pathStr)) {
        try {
          const u = new URL(pathStr);
          pathStr = u.pathname || "/";
        } catch {
          /* keep */
        }
      }
      if (!pathStr.startsWith("/")) pathStr = "/" + pathStr;
      pathStr = pathStr.replace(/\/{2,}/g, "/");
      if (pathStr === "/" || /\/Uploads\/?$/i.test(pathStr)) continue;
      // Drop pure version strings
      if (/^\d+\.\d+/.test(pathStr.replace(/^\//, ""))) continue;

      apis.push({
        method: "POST",
        path: pathStr,
        file: f.path,
        name,
      });
    }
  }

  // Dedupe by name preferentially
  const byName = new Map();
  for (const a of apis) {
    const k = a.name || `${a.method}:${a.path}`;
    if (!byName.has(k)) byName.set(k, a);
  }
  return [...byName.values()];
}
