import fs from "fs/promises";
import path from "path";
import { IGNORE_DIRS } from "../scanner/constants.js";

/** Infrastructure / non-feature folders — never show as modules */
const NOISE_DIRS = new Set([
  ...IGNORE_DIRS,
  "public",
  "static",
  "assets",
  "images",
  "fonts",
  "styles",
  "css",
  "locales",
  "i18n",
  "l10n",
  "gen",
  "generated",
  "__mocks__",
  "__tests__",
  "cypress",
  "e2e",
  "storybook",
  ".storybook",
  "coverage",
  "documentation",
  "docs",
  "scripts",
  "tools",
  "migrations",
  "seeders",
  "fixtures",
  "types",
  "typings",
  "hooks",
  "utils",
  "helpers",
  "ui",
  "shared",
  "common",
  "core",
  "constants",
  "config",
  "configs",
  "store",
  "stores",
  "context",
  "contexts",
  "providers",
  "theme",
  "themes",
  "network",
  "services",
  "api",
  "components", // UI kit under app — not a feature module root child
  "widgets",
  "models",
  "data",
  "domain",
  "presentation",
  "infrastructure",
]);

/** Folder names that wrap real feature modules */
const FEATURE_WRAPPERS = new Set([
  "screen",
  "screens",
  "feature",
  "features",
  "module",
  "modules",
  "page",
  "pages",
  "view",
  "views",
]);

/** .NET project/module roots (additive — does not change Flutter/RN/Next logic) */
const DOTNET_MODULE_REL = [
  ["Features", 21],
  ["Controllers", 20],
  ["Areas", 17],
  ["Pages", 16],
  ["Views", 14],
  ["Endpoints", 18],
  ["Modules", 18],
];

const DOTNET_SKIP_FILES =
  /^(program|startup|assemblyinfo|global\.usings|_viewstart|_viewimports|appsettings)\.cs$/i;

const DOTNET_MODULE_FILE_RE =
  /\.(cs|vb|fs|cshtml|razor)$/i;

const CODE_FILE_RE =
  /\.(dart|tsx?|jsx?|mjs|cjs|vue|svelte|py|java|kt|cs|cshtml|razor|vb|fs|go|rb|php|swift)$/i;

function shouldIgnoreDir(name) {
  if (!name) return true;
  if (name.startsWith(".") && name !== ".github") return true;
  if (IGNORE_DIRS.has(name)) return true;
  return false;
}

function isNoiseModuleDir(name) {
  const n = name.toLowerCase();
  if (NOISE_DIRS.has(n)) return true;
  return false;
}

function normalizeSeg(name) {
  if (/^\([^)]+\)$/.test(name)) return name.slice(1, -1);
  return name;
}

function kindFromName(name) {
  const raw = String(name).toLowerCase();
  const n = raw.replace(/\.(dart|tsx?|jsx?|vue|svelte|cs|py|java)$/i, "");

  if (
    n === "new" ||
    n.startsWith("add_") ||
    n.includes("_add_") ||
    n.endsWith("_add") ||
    n.startsWith("create_") ||
    n.includes("add_person") ||
    n.includes("add_attendance")
  )
    return "add";
  if (
    n === "edit" ||
    n.startsWith("edit_") ||
    n.includes("_edit_") ||
    n.endsWith("_edit") ||
    n.startsWith("update_")
  )
    return "edit";
  if (
    n === "details" ||
    n === "detail" ||
    /^\[.+\]$/.test(name) ||
    n.includes("details") ||
    n.endsWith("_detail") ||
    n.includes("person_details") ||
    n.includes("view_details")
  )
    return "details";
  if (n === "list" || n.endsWith("_list") || n.startsWith("list_") || n.includes("_list_"))
    return "list";
  if (n === "view" || n.startsWith("view_") || n.endsWith("_view") || n.includes("view_edit"))
    return "view";
  if (n === "form" || n.endsWith("_form") || n.startsWith("form_")) return "form";
  if (n === "page" || n.endsWith("_page") || n.endsWith("-page") || n.endsWith("page"))
    return "page";
  if (n === "screen" || n.endsWith("_screen") || n.endsWith("screen")) return "screen";
  if (n.endsWith("controller")) return "controller";
  if (n.endsWith("command")) return "add";
  if (n.endsWith("query")) return "view";
  if (n.endsWith("handler")) return "file";
  if (n.endsWith("service")) return "file";
  if (n.endsWith("repository")) return "file";
  if (n.startsWith("page.")) return "page";
  if (n.startsWith("layout.")) return "layout";
  if (n.startsWith("route.")) return "api";
  if (n.startsWith("index.")) return "index";
  return "file";
}

async function readDirSafe(abs) {
  try {
    return await fs.readdir(abs, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function isDotnetModuleRoot(label) {
  return /(?:^|\/)(Controllers|Features|Areas|Endpoints|Pages|Modules)(\/|$)/i.test(
    label || ""
  );
}

function formatDotnetSegment(fileName) {
  let n = String(fileName).replace(/\.(cs|vb|fs|cshtml|razor)$/i, "");
  n = n.replace(/Controller$/i, "");
  n = n.replace(
    /(Command|Query|Handler|Request|Response|Dto|DTO|ViewModel|Service|Repository)$/i,
    ""
  );
  if (!n) n = fileName.replace(/\.[^.]+$/, "");
  return n
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

function formatDotnetDisplayName(fileName) {
  const seg = formatDotnetSegment(fileName);
  return seg.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || fileName;
}

function promoteDotnetFileNodes(screens, pathPrefix = "") {
  const moduleFiles = (screens || []).filter(
    (s) => DOTNET_MODULE_FILE_RE.test(s.name) && !DOTNET_SKIP_FILES.test(s.name)
  );
  if (!moduleFiles.length) return [];

  return moduleFiles.map((s) => {
    const seg = formatDotnetSegment(s.name);
    const nodePath = pathPrefix ? `${pathPrefix}/${seg}` : seg;
    return {
      name: formatDotnetDisplayName(s.name),
      path: nodePath,
      screens: [s],
      screenKinds: [s.kind !== "file" ? s.kind : "controller"],
      children: [],
      fileCount: 1,
    };
  });
}

function expandDotnetFileModules(modules) {
  const out = [];
  for (const m of modules || []) {
    let children = expandDotnetFileModules(m.children || []);
    if (!children.length && (m.screens || []).length) {
      children = promoteDotnetFileNodes(m.screens, m.path || "");
    }
    out.push({
      ...m,
      children,
      screens: children.length ? [] : m.screens || [],
      fileCount:
        children.length ||
        (m.screens || []).length + children.reduce((n, c) => n + (c.fileCount || 0), 0),
    });
  }
  return out;
}

async function registerDotnetProjectRoots(projectAbs, projectRel, addRoot) {
  for (const [rel, priority] of DOTNET_MODULE_REL) {
    const abs = path.join(projectAbs, ...rel.split("/"));
    if (await fileExists(abs)) {
      const label = projectRel ? `${projectRel}/${rel}` : rel;
      addRoot(abs, label, priority);
    }
  }

  const areasAbs = path.join(projectAbs, "Areas");
  if (await fileExists(areasAbs)) {
    for (const area of await readDirSafe(areasAbs)) {
      if (!area.isDirectory() || shouldIgnoreDir(area.name)) continue;
      const ctrlAbs = path.join(areasAbs, area.name, "Controllers");
      if (await fileExists(ctrlAbs)) {
        const rel = projectRel
          ? `${projectRel}/Areas/${area.name}/Controllers`
          : `Areas/${area.name}/Controllers`;
        addRoot(ctrlAbs, rel, 19);
      }
      const viewsAbs = path.join(areasAbs, area.name, "Views");
      if (await fileExists(viewsAbs)) {
        const rel = projectRel
          ? `${projectRel}/Areas/${area.name}/Views`
          : `Areas/${area.name}/Views`;
        addRoot(viewsAbs, rel, 15);
      }
    }
  }
}

async function discoverDotnetProjects(rootDir, addRoot) {
  async function walk(baseAbs, baseRel, depth) {
    if (depth > 6) return;
    const entries = await readDirSafe(baseAbs);
    const hasCsproj = entries.some(
      (e) => e.isFile() && /\.(csproj|fsproj|vbproj)$/i.test(e.name)
    );
    if (hasCsproj) {
      await registerDotnetProjectRoots(baseAbs, baseRel, addRoot);
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || shouldIgnoreDir(e.name)) continue;
      const lower = e.name.toLowerCase();
      if (["bin", "obj", "node_modules", "packages", ".git"].includes(lower)) continue;
      const childAbs = path.join(baseAbs, e.name);
      const childRel = baseRel ? `${baseRel}/${e.name}` : e.name;
      await walk(childAbs, childRel, depth + 1);
    }
  }
  await walk(rootDir, "", 0);
}

async function walkModuleTree(abs, relParts, opts = {}) {
  const { maxDepth = 10 } = opts;
  const depth = relParts.length;
  const entries = await readDirSafe(abs);

  const dirs = entries.filter((e) => e.isDirectory() && !shouldIgnoreDir(e.name));
  const files = entries.filter((e) => e.isFile() && CODE_FILE_RE.test(e.name));

  const screens = files
    .map((f) => ({
      file: [...relParts, f.name].join("/"),
      name: f.name,
      kind: kindFromName(f.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const folderKinds = [];
  for (const d of dirs) {
    const k = kindFromName(d.name);
    if (["add", "edit", "details", "list", "view", "form"].includes(k)) folderKinds.push(k);
  }

  const children = [];
  if (depth < maxDepth) {
    for (const d of dirs) {
      // Keep route groups; skip noise infrastructure
      if (isNoiseModuleDir(d.name) && !/^\(.*\)$/.test(d.name)) continue;

      const seg = normalizeSeg(d.name);
      const child = await walkModuleTree(path.join(abs, d.name), [...relParts, seg], opts);
      children.push(child);
    }
  }
  children.sort((a, b) => a.name.localeCompare(b.name));

  const name = relParts[relParts.length - 1] || "root";
  const pathStr = relParts.join("/");
  const screenKinds = [
    ...new Set([
      ...screens.map((s) => s.kind).filter((k) => !["file", "index", "layout"].includes(k)),
      ...folderKinds,
    ]),
  ];

  const displayName = (() => {
    const n = normalizeSeg(name);
    if (/^\[.+\]$/.test(n)) return "details";
    if (n === "new") return "new (add)";
    return n;
  })();

  return {
    name: displayName,
    path: pathStr,
    screens,
    screenKinds,
    children,
    fileCount: screens.length + children.reduce((n, c) => n + (c.fileCount || 0), 0),
  };
}

function flattenTree(node, out = [], depth = 0) {
  if (!node) return out;
  if (node.path) {
    out.push({
      name: node.name,
      path: node.path,
      depth,
      screenKinds: node.screenKinds || [],
      screens: (node.screens || []).map((s) => (s.kind !== "file" ? s.kind : s.name)),
      childCount: (node.children || []).length,
      fileCount: node.fileCount || 0,
    });
  }
  for (const c of node.children || []) flattenTree(c, out, depth + 1);
  return out;
}

function pruneEmpty(node) {
  if (!node) return null;
  const children = (node.children || []).map(pruneEmpty).filter(Boolean);
  const hasSignal =
    (node.screens || []).length > 0 ||
    (node.screenKinds || []).length > 0 ||
    children.length > 0;
  if (!hasSignal) return null;
  return { ...node, children };
}

function treeQuality(modules) {
  let score = 0;
  let maxDepth = 0;
  let leaves = 0;
  const walk = (n, d) => {
    maxDepth = Math.max(maxDepth, d);
    score += 2;
    if ((n.screenKinds || []).length) score += n.screenKinds.length * 3;
    if ((n.children || []).length === 0 && ((n.screens || []).length || (n.screenKinds || []).length)) {
      leaves += 1;
      score += 5;
    }
    // Penalty noise names at top
    if (d === 0 && isNoiseModuleDir(n.name)) score -= 20;
    for (const c of n.children || []) walk(c, d + 1);
  };
  for (const m of modules || []) walk(m, 0);
  score += maxDepth * 4 + leaves * 2;
  return score;
}

/**
 * Discover candidate roots across stacks + monorepos.
 */
async function findModuleRoots(rootDir) {
  const roots = [];
  const seen = new Set();

  const addRoot = (abs, label, priority = 0) => {
    const key = path.resolve(abs);
    if (seen.has(key)) return;
    seen.add(key);
    roots.push({ abs, label: label.replace(/\\/g, "/"), priority });
  };

  // Higher priority = preferred. screen(s) beat generic src/app.
  const candidates = [
    ["lib/screens", 20],
    ["lib/features", 20],
    ["lib/modules", 18],
    ["lib/pages", 16],
    ["lib/screen", 20],
    ["src/screens", 20],
    ["src/screen", 20],
    ["src/features", 20],
    ["src/modules", 18],
    ["src/app/screens", 22],
    ["src/app/screen", 22],
    ["app/screens", 20],
    ["app/screen", 20],
    ["src/pages", 14],
    ["pages", 12],
    ["src/views", 12],
    ["src/app", 10], // Next routes OR parent of screen/
    ["app", 9],
    ["src/components", 3],
    ["Controllers", 20],
    ["Features", 21],
    ["Areas", 17],
    ["Endpoints", 18],
    ["Pages", 16],
    ["Modules", 18],
    ["apps", 10],
    ["routers", 10],
  ];

  async function tryAdd(baseAbs, baseRel) {
    for (const [rel, priority] of candidates) {
      const abs = path.join(baseAbs, ...rel.split("/"));
      if (await fileExists(abs)) {
        const label = baseRel ? `${baseRel}/${rel}` : rel;
        addRoot(abs, label, priority);
      }
    }
  }

  await tryAdd(rootDir, "");
  await discoverDotnetProjects(rootDir, addRoot);

  // Dynamic: find any .../screen(s)|features|modules under src|lib|app (depth-limited)
  async function discoverWrappers(baseAbs, baseRel, depth) {
    if (depth > 4) return;
    for (const e of await readDirSafe(baseAbs)) {
      if (!e.isDirectory() || shouldIgnoreDir(e.name)) continue;
      const childAbs = path.join(baseAbs, e.name);
      const childRel = baseRel ? `${baseRel}/${e.name}` : e.name;
      const lower = e.name.toLowerCase();
      if (FEATURE_WRAPPERS.has(lower)) {
        addRoot(childAbs, childRel.replace(/\\/g, "/"), 21);
      }
      if (["src", "lib", "app", "apps", "packages"].includes(lower) || depth < 2) {
        await discoverWrappers(childAbs, childRel, depth + 1);
      }
    }
  }
  await discoverWrappers(rootDir, "", 0);

  // Monorepo app packages
  for (const e of await readDirSafe(rootDir)) {
    if (!e.isDirectory() || shouldIgnoreDir(e.name)) continue;
    if (["packages", "apps", "services"].includes(e.name)) {
      for (const s of await readDirSafe(path.join(rootDir, e.name))) {
        if (!s.isDirectory() || shouldIgnoreDir(s.name)) continue;
        await tryAdd(path.join(rootDir, e.name, s.name), `${e.name}/${s.name}`);
        await discoverWrappers(
          path.join(rootDir, e.name, s.name),
          `${e.name}/${s.name}`,
          0
        );
      }
    } else if (
      (await fileExists(path.join(rootDir, e.name, "pubspec.yaml"))) ||
      (await fileExists(path.join(rootDir, e.name, "package.json"))) ||
      (await readDirSafe(path.join(rootDir, e.name))).some((f) =>
        f.isFile() && /\.(csproj|fsproj|vbproj)$/i.test(f.name)
      )
    ) {
      await tryAdd(path.join(rootDir, e.name), e.name);
      await discoverWrappers(path.join(rootDir, e.name), e.name, 0);
      await registerDotnetProjectRoots(path.join(rootDir, e.name), e.name, addRoot);
    }
  }

  if (roots.length === 0) {
    const srcAbs = path.join(rootDir, "src");
    if (await fileExists(srcAbs)) addRoot(srcAbs, "src", 1);
    else addRoot(rootDir, ".", 0);
  }

  roots.sort((a, b) => b.priority - a.priority);
  return roots;
}

async function collectLocalPackages(rootDir) {
  const names = new Set();
  for (const folder of ["packages", "apps"]) {
    for (const e of await readDirSafe(path.join(rootDir, folder))) {
      if (e.isDirectory() && !shouldIgnoreDir(e.name)) names.add(e.name);
    }
  }
  for (const e of await readDirSafe(rootDir)) {
    if (!e.isDirectory()) continue;
    if (await fileExists(path.join(rootDir, e.name, "pubspec.yaml"))) names.add(e.name);
    const csproj = (await readDirSafe(path.join(rootDir, e.name))).find(
      (f) => f.isFile() && /\.(csproj|fsproj|vbproj)$/i.test(f.name)
    );
    if (csproj) names.add(e.name);
  }
  return [...names].sort();
}

/**
 * If root is src/app and contains screen/screens/features, unwrap to that child.
 */
async function unwrapFeatureRoot(root) {
  const entries = await readDirSafe(root.abs);
  const wrappers = entries.filter(
    (e) => e.isDirectory() && FEATURE_WRAPPERS.has(e.name.toLowerCase())
  );
  if (!wrappers.length) return root;

  // Prefer screens/screen with richest children
  let best = null;
  for (const w of wrappers) {
    const abs = path.join(root.abs, w.name);
    const kids = (await readDirSafe(abs)).filter(
      (e) => e.isDirectory() && !shouldIgnoreDir(e.name) && !isNoiseModuleDir(e.name)
    );
    const score = kids.length * 10 + (w.name.toLowerCase().includes("screen") ? 5 : 0);
    if (!best || score > best.score) {
      best = {
        abs,
        label: `${root.label}/${w.name}`.replace(/\\/g, "/"),
        priority: Math.max(root.priority, 22),
        score,
      };
    }
  }
  return best && best.score >= 10 ? best : root;
}

/**
 * Deep module tree — best effort for Flutter, RN, Next, Expo, etc.
 */
export async function collectDeepModulesFromDisk(rootDir) {
  let roots = await findModuleRoots(rootDir);
  const localPackages = await collectLocalPackages(rootDir);

  // Unwrap src/app → src/app/screen when applicable (attendance-style)
  roots = await Promise.all(roots.map((r) => unwrapFeatureRoot(r)));
  // Dedupe by abs after unwrap
  const byAbs = new Map();
  for (const r of roots) {
    const k = path.resolve(r.abs);
    const prev = byAbs.get(k);
    if (!prev || r.priority > prev.priority) byAbs.set(k, r);
  }
  roots = [...byAbs.values()].sort((a, b) => b.priority - a.priority);

  const built = [];
  for (const r of roots) {
    if (/components$/i.test(r.label) && roots.some((x) => x.priority >= 15)) continue;

    const tree = await walkModuleTree(r.abs, [], { maxDepth: 12 });
    let modules = tree.children?.length ? tree.children : [];

    // .NET: flat Controllers/Features — promote .cs files to nested module nodes
    if (!modules.length && isDotnetModuleRoot(r.label) && (tree.screens || []).length) {
      modules = promoteDotnetFileNodes(tree.screens);
    }
    // Expand nested .NET folders (Features/Billing/...) — skip flat Controllers already promoted
    if (isDotnetModuleRoot(r.label) && tree.children?.length) {
      modules = expandDotnetFileModules(modules);
    }

    // Filter noise top-level
    modules = modules.filter((m) => !isNoiseModuleDir(m.name));
    modules = modules.map(pruneEmpty).filter(Boolean);
    if (!modules.length) continue;

    const quality = treeQuality(modules);
    built.push({
      root: r.label,
      priority: r.priority,
      quality,
      modules,
    });
  }

  // Prefer specific roots; drop parents of kept children
  built.sort((a, b) => b.quality - a.quality || b.priority - a.priority || b.root.length - a.root.length);

  const filtered = [];
  for (const t of built) {
    const parentOfKept = filtered.some((k) => k.root.startsWith(t.root + "/"));
    if (parentOfKept) continue;
    const childOfKept = filtered.some((k) => t.root.startsWith(k.root + "/"));
    if (childOfKept) continue;
    // Keep multiple only if both high quality (e.g. flutter screens + something else)
    if (filtered.length && t.quality < filtered[0].quality * 0.35) continue;
    filtered.push(t);
  }

  // If we have one clear winner, use only that for clean UI
  let finalTrees = filtered;
  const dotnetTrees = filtered.filter(
    (t) => isDotnetModuleRoot(t.root) && t.quality >= 10
  );
  if (dotnetTrees.length >= 2) {
    // Keep all meaningful .NET roots (Features + Controllers + Areas/…)
    finalTrees = dotnetTrees.filter(
      (t) => t.quality >= Math.max(10, dotnetTrees[0].quality * 0.2)
    );
  } else if (filtered.length > 1) {
    const best = filtered[0];
    const close = filtered.filter((t) => t.quality >= best.quality * 0.7);
    // Prefer single best tree unless close competitors are different domains (e.g. lib/screens vs src/app)
    finalTrees = close.length <= 2 ? close : [best];
  }

  finalTrees.sort((a, b) => b.priority - a.priority || a.root.localeCompare(b.root));

  const flat = [];
  for (const t of finalTrees) {
    for (const m of t.modules) flattenTree(m, flat, 0);
  }

  const internal = [
    ...new Set(
      flat
        .filter((m) => (m.fileCount || 0) > 0 || (m.childCount || 0) > 0)
        .map((m) => m.path || m.name)
    ),
  ];

  const leaves = flat.filter(
    (m) =>
      ((m.screens || []).length > 0 || (m.screenKinds || []).length > 0) &&
      (m.childCount || 0) === 0
  );

  return {
    packages: localPackages,
    internal,
    tree: finalTrees.map(({ root, modules, priority, quality }) => ({
      root,
      priority,
      quality,
      modules,
    })),
    flat,
    leaves: leaves.map((l) => ({
      name: l.name,
      path: l.path,
      screens: l.screenKinds,
      parent: l.path.includes("/") ? l.path.split("/").slice(0, -1).join("/") : null,
    })),
  };
}
