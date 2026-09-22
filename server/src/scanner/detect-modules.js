import path from "path";

const GENERIC_SKIP = new Set([
  "src",
  "lib",
  "app",
  "apps",
  "test",
  "tests",
  "__tests__",
  "spec",
  "specs",
  "public",
  "assets",
  "static",
  "dist",
  "build",
  "out",
  "node_modules",
  "components",
  "pages",
  "styles",
  "utils",
  "hooks",
  "types",
  "typings",
  "config",
  "configs",
  "scripts",
  "bin",
  "docs",
  "doc",
  "examples",
  "example",
  "fixtures",
  "mocks",
  "vendor",
  "include",
  "resources",
  "res",
  "ios",
  "android",
  "macos",
  "windows",
  "linux",
  "web",
  "main",
  "java",
  "kotlin",
  "gen",
  "generated",
  "l10n",
  "data",
  "domain",
  "presentation",
  "widgets",
  "widget",
  "model",
  "models",
  "repository",
  "repositories",
  "providers",
  "provider",
  "bloc",
  "blocs",
  "cubit",
  "view",
  "views",
  "controller",
  "controllers",
  "helper",
  "helpers",
  "extension",
  "extensions",
  "constant",
  "constants",
  "core",
  "common",
  "shared",
  "internal",
  "external",
  "api",
]);

function niceName(name) {
  return name;
}

function isModuleName(name) {
  if (!name || name.startsWith(".")) return false;
  if (path.extname(name)) return false;
  if (GENERIC_SKIP.has(name) || GENERIC_SKIP.has(name.toLowerCase())) return false;
  return true;
}

/**
 * Detect project modules (feature folders / packages) + dependency packages.
 */
export function detectModules(files, packages) {
  const internal = new Set();
  const localPackages = new Set();
  const featureDirs = new Map(); // name -> count

  const hasPubspec = files.some((f) => f.base === "pubspec.yaml");
  const hasPackageJson = files.some((f) => f.base === "package.json");

  // Local Flutter/Dart packages: any folder with its own pubspec.yaml
  for (const f of files) {
    if (f.base !== "pubspec.yaml") continue;
    const parts = f.rel.replace(/\\/g, "/").split("/").filter(Boolean);
    if (parts.length === 1) {
      // root app — try to read name from content
      if (f.content) {
        const m = f.content.match(/^name:\s*([A-Za-z0-9_]+)/m);
        if (m) localPackages.add(m[1]);
      }
      continue;
    }
    // packages/network/pubspec.yaml → network
    // udd_gujarat_app/pubspec.yaml → udd_gujarat_app
    const pkgFolder = parts[parts.length - 2];
    if (isModuleName(pkgFolder) || pkgFolder.endsWith("_app") || pkgFolder.includes("_")) {
      localPackages.add(pkgFolder);
    } else if (pkgFolder) {
      localPackages.add(pkgFolder);
    }
  }

  for (const f of files) {
    const parts = f.rel.replace(/\\/g, "/").split("/").filter(Boolean);
    if (parts.length < 2) continue;

    // Flutter: lib/screens/<feature>/...
    const screensIdx = parts.findIndex((p) => p.toLowerCase() === "screens");
    if (screensIdx >= 0) {
      for (let i = screensIdx + 1; i < Math.min(parts.length - 1, screensIdx + 4); i++) {
        const name = parts[i];
        if (isModuleName(name)) {
          featureDirs.set(name, (featureDirs.get(name) || 0) + 1);
        }
      }
    }

    // Flutter: lib/features/<feature>/...
    const featuresIdx = parts.findIndex((p) => p.toLowerCase() === "features");
    if (featuresIdx >= 0 && parts[featuresIdx + 1] && isModuleName(parts[featuresIdx + 1])) {
      featureDirs.set(parts[featuresIdx + 1], (featureDirs.get(parts[featuresIdx + 1]) || 0) + 1);
    }

    // Flutter network package: packages/network/lib/<api_feature>/...
    const netLib = parts.findIndex(
      (p, i) =>
        p === "lib" &&
        i > 0 &&
        (parts[i - 1] === "network" || parts[i - 1].includes("network"))
    );
    if (netLib >= 0 && parts[netLib + 1] && isModuleName(parts[netLib + 1])) {
      // Prefer readable feature modules, skip noise
      const feat = parts[netLib + 1];
      if (!["core", "gen", "src"].includes(feat)) {
        featureDirs.set(feat, (featureDirs.get(feat) || 0) + 1);
      }
    }

    // packages/<name>/ as workspace package already handled via pubspec

    // Generic: src|app|lib|modules|features / <module>
    const roots = ["src", "app", "modules", "features", "domain", "services"];
    const rootIdx = parts.findIndex((p) => roots.includes(p.toLowerCase()));
    if (rootIdx >= 0 && parts[rootIdx + 1] && isModuleName(parts[rootIdx + 1])) {
      // Don't treat "screens" itself
      if (parts[rootIdx + 1].toLowerCase() !== "screens") {
        featureDirs.set(parts[rootIdx + 1], (featureDirs.get(parts[rootIdx + 1]) || 0) + 1);
      }
    }
  }

  // Assemble internal modules: local packages first, then meaningful features
  for (const p of localPackages) internal.add(niceName(p));

  // For Flutter, prefer screen/feature modules over every get_* network folder flood
  const screenish = [...featureDirs.entries()]
    .filter(([name]) => {
      // If flutter project, de-prioritize get_* api folders in "internal" if we have screen modules
      return true;
    })
    .sort((a, b) => b[1] - a[1]);

  const hasScreenModules = screenish.some(([n]) =>
    ["authentication", "dashboard", "home", "manage", "reports", "settings", "splash"].includes(
      n.toLowerCase()
    )
  );

  for (const [name, count] of screenish) {
    if (count < 1) continue;
    // If we have UI modules, skip flooding with every get_* API module in internal
    if (hasScreenModules && (/^get_/i.test(name) || /^otp_/i.test(name) || name === "login")) {
      continue;
    }
    internal.add(niceName(name));
  }

  // If no screen modules found, include top network feature folders (capped)
  if (!hasScreenModules) {
    for (const [name, count] of screenish.slice(0, 60)) {
      if (count >= 1) internal.add(niceName(name));
    }
  }

  // Also add manage/* domain folders already collected (beneficiary, fund_management, ...)
  // already in featureDirs

  let internalList = [...internal].sort();

  // Cap
  if (internalList.length > 100) internalList = internalList.slice(0, 100);

  // Dependency packages: exclude local package names from pub deps list noise? Keep deps.
  // For Flutter, prefer only root + package pubspec direct deps, already in `packages` arg.
  let pkgList = (packages || []).filter(Boolean);

  // Drop flutter SDK noise
  pkgList = pkgList.filter(
    (p) => !["flutter", "flutter_test", "flutter_lints", "cupertino_icons"].includes(p)
  );

  // Prefer unique sorted, cap
  pkgList = [...new Set(pkgList)].sort().slice(0, 200);

  // If Flutter monorepo, surface local packages at top of internal (already added)

  // Fallback for non-flutter: keep previous-ish behavior
  if (!hasPubspec && hasPackageJson && internalList.length < 3) {
    for (const f of files) {
      const parts = f.rel.replace(/\\/g, "/").split("/").filter(Boolean);
      const roots = ["src", "app", "lib", "packages", "modules", "features"];
      const rootIdx = parts.findIndex((p) => roots.includes(p.toLowerCase()));
      if (rootIdx >= 0 && parts[rootIdx + 1] && isModuleName(parts[rootIdx + 1])) {
        internal.add(parts[rootIdx + 1]);
      }
    }
    internalList = [...internal].sort().slice(0, 80);
  }

  return {
    packages: pkgList,
    internal: internalList,
  };
}
