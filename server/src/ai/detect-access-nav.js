/**
 * Roles, permissions, and screen navigation — evidence only.
 * Never invent Admin/roles or screens not found in the zip / live DB schema names.
 */
import fs from "fs/promises";
import path from "path";
import { IGNORE_DIRS } from "../scanner/constants.js";

const ROLE_FILE_HINT =
  /role|permission|claim|authorize|auth|policy|acl|rbac/i;

const MAX_FILES = 400;
const MAX_FILE_BYTES = 200_000;

async function readDirSafe(dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function shouldSkipDir(name) {
  if (!name || (name.startsWith(".") && name !== ".github")) return true;
  if (IGNORE_DIRS.has(name)) return true;
  return ["node_modules", "coverage", "dist", "build", ".git", ".idea"].includes(
    name.toLowerCase()
  );
}

function titleCase(name) {
  return String(name || "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function niceScreenName(raw) {
  let n = String(raw || "")
    .replace(/\.(dart|tsx?|jsx?|vue|svelte|cshtml|razor)$/i, "")
    .replace(/_screen$/i, "")
    .replace(/Screen$/i, "")
    .replace(/Page$/i, "")
    .replace(/View$/i, "");
  return titleCase(n) || String(raw);
}

async function collectCandidateFiles(rootDir) {
  const out = [];
  async function walk(abs, rel, depth) {
    if (out.length >= MAX_FILES || depth > 10) return;
    for (const e of await readDirSafe(abs)) {
      if (out.length >= MAX_FILES) break;
      if (e.isDirectory()) {
        if (shouldSkipDir(e.name)) continue;
        await walk(path.join(abs, e.name), rel ? `${rel}/${e.name}` : e.name, depth + 1);
        continue;
      }
      if (!e.isFile()) continue;
      const lower = e.name.toLowerCase();
      if (!/\.(cs|dart|ts|tsx|js|jsx|py|java|kt|json)$/i.test(lower)) continue;
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      const hint =
        ROLE_FILE_HINT.test(relPath) ||
        /enum|constant|claim|policy|authorize|menu/i.test(lower);
      // Prefer role-ish paths; still sample other code lightly for Authorize attributes
      if (hint || /\.(cs|dart)$/i.test(lower)) {
        out.push({ abs: path.join(abs, e.name), rel: relPath, priority: hint ? 2 : 1 });
      }
    }
  }
  await walk(rootDir, "", 0);
  out.sort((a, b) => b.priority - a.priority);
  return out.slice(0, MAX_FILES);
}

function addUnique(set, value, evidence, evidenceList, source) {
  const v = String(value || "").trim();
  if (!v || v.length < 2 || v.length > 64) return;
  if (/^(true|false|null|string|int|bool|object|void|get|set|post|put|delete)$/i.test(v)) return;
  if (/^[0-9]+$/.test(v)) return;
  const key = v.toLowerCase();
  if (set.has(key)) return;
  set.set(key, v);
  if (source) evidenceList.push(`${source}: ${v}`);
}

function extractRolesAndPermissions(content, rel, roles, permissions, evidence) {
  if (!content) return;

  // [Authorize(Roles = "Admin,Manager")]
  for (const m of content.matchAll(/Authorize\s*\(\s*Roles\s*=\s*"([^"]+)"/gi)) {
    for (const part of m[1].split(/[,;]/)) {
      addUnique(roles, part.trim(), evidence, evidence, rel);
    }
  }
  // Roles = "Admin" / role: 'admin'
  for (const m of content.matchAll(/\bRoles?\s*[=:]\s*["']([A-Za-z][A-Za-z0-9_ ]{1,40})["']/g)) {
    addUnique(roles, m[1], evidence, evidence, rel);
  }
  // enum Role { Admin, User }
  for (const m of content.matchAll(
    /enum\s+(?:User)?Role[s]?\s*\{([^}]+)\}/gi
  )) {
    for (const part of m[1].split(/[,\n]/)) {
      const name = part.replace(/[=:].*$/, "").replace(/\/\/.*$/, "").trim();
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) addUnique(roles, name, evidence, evidence, rel);
    }
  }
  // Dart/TS: Role.admin / UserRole.manager
  for (const m of content.matchAll(/\b(?:User)?Role[s]?\.(?:values\.)?([A-Za-z_][A-Za-z0-9_]*)/g)) {
    if (!/^(values|of|fromJson|toJson|name|index)$/i.test(m[1])) {
      addUnique(roles, m[1], evidence, evidence, rel);
    }
  }
  // Permission strings / claims
  for (const m of content.matchAll(
    /\bPermissions?\s*[=:]\s*["']([A-Za-z][A-Za-z0-9_.:\-]{1,60})["']/g
  )) {
    addUnique(permissions, m[1], evidence, evidence, rel);
  }
  for (const m of content.matchAll(
    /\bClaimTypes?\.[A-Za-z]+.*?["']([A-Za-z][A-Za-z0-9_.:\-]{1,60})["']/g
  )) {
    addUnique(permissions, m[1], evidence, evidence, rel);
  }
  for (const m of content.matchAll(
    /\b(?:HasPermission|CheckPermission|RequirePermission|permission)\s*\(\s*["']([A-Za-z][A-Za-z0-9_.:\-]{1,60})["']/gi
  )) {
    addUnique(permissions, m[1], evidence, evidence, rel);
  }
  // "permission": "users.create"
  for (const m of content.matchAll(
    /["']permission["']\s*:\s*["']([A-Za-z][A-Za-z0-9_.:\-]{1,60})["']/gi
  )) {
    addUnique(permissions, m[1], evidence, evidence, rel);
  }
  // RoleMaster / UserPermission style identifiers in strings
  for (const m of content.matchAll(
    /(?:RoleName|role_name|RoleCode)\s*[=:]\s*["']([A-Za-z][A-Za-z0-9_ ]{1,40})["']/g
  )) {
    addUnique(roles, m[1], evidence, evidence, rel);
  }
}

function extractRolesFromApis(apis, roles, permissions, evidence) {
  for (const a of apis || []) {
    const blob = `${a.path || ""} ${a.name || ""} ${a.action || ""} ${a.handler || ""}`;
    if (/role/i.test(blob) && !/controller$/i.test(blob)) {
      evidence.push(`api:${a.method || "GET"} ${a.path || a.name}`);
    }
    if (/permission/i.test(blob)) {
      evidence.push(`api:${a.method || "GET"} ${a.path || a.name}`);
    }
    // Don't invent role names from path alone — only flag evidence
  }
}

function extractFromDbAnalysis(databaseAnalysis, roles, permissions, evidence) {
  const tables = databaseAnalysis?.tables || [];
  for (const t of tables) {
    const name = String(t.name || "");
    if (!name) continue;
    if (/role|rolemaster|userrole|aspnetroles/i.test(name)) {
      evidence.push(`db-table:${name}`);
      // Column names that look like role labels — still not row values
      for (const c of t.importantColumns || t.columns || []) {
        const col = typeof c === "string" ? c : c.name;
        if (col && /rolename|role_name|name|code/i.test(col)) {
          evidence.push(`db-column:${name}.${col}`);
        }
      }
    }
    if (/permission|userpermission|claim|aspnetroleclaims/i.test(name)) {
      evidence.push(`db-table:${name}`);
    }
  }
}

const NAV_PRIORITY = [
  "splash",
  "onboarding",
  "welcome",
  "login",
  "signin",
  "authentication",
  "auth",
  "otp",
  "home",
  "dashboard",
  "main",
];

function navRank(name) {
  const n = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  const idx = NAV_PRIORITY.findIndex((p) => n === p || n.startsWith(p) || n.includes(p));
  return idx >= 0 ? idx : 50 + (name || "").length;
}

function collectScreensFromDeepModules(deepModules) {
  const screens = [];
  const seen = new Set();
  const uiRoot = (deepModules?.tree || []).some((t) =>
    /screen|feature|page|view/i.test(t.root || "")
  );

  function walk(node, depth) {
    if (!node) return;
    const name = niceScreenName(node.name || "");
    const key = name.toLowerCase();
    const hasKids = (node.children || []).length > 0;
    const hasFiles = (node.screens || []).length > 0 || (node.fileCount || 0) > 0;
    if (
      name &&
      !hasKids &&
      (hasFiles || depth > 0) &&
      !/\.(py|js|ts|cs)$/i.test(String(node.name || "")) &&
      !/middleware|algo|service|repository|helper|util/i.test(name)
    ) {
      if (!seen.has(key) && !/^(file|index|layout|widgets?|components?)$/i.test(name)) {
        seen.add(key);
        screens.push({ name, path: node.path || name, rank: navRank(name) });
      }
    }
    for (const c of node.children || []) walk(c, depth + 1);
    if (uiRoot) {
      for (const s of node.screens || []) {
        const sn = niceScreenName(s.name || s.file || "");
        const sk = sn.toLowerCase();
        if (
          sn &&
          !seen.has(sk) &&
          !/^(file|index|layout)$/i.test(sn) &&
          !/\.(py|js|ts)$/i.test(String(s.name || ""))
        ) {
          seen.add(sk);
          screens.push({ name: sn, path: s.file || sn, rank: navRank(sn) });
        }
      }
    }
  }

  for (const t of deepModules?.tree || []) {
    // Controllers/Routes roots → treat promoted handler modules as areas (not .py noise)
    if (/controller|route|handler/i.test(t.root || "")) {
      for (const m of t.modules || []) {
        const name = niceScreenName(m.name);
        const key = name.toLowerCase();
        if (
          name &&
          !seen.has(key) &&
          !/python|algo|test|middleware/i.test(name) &&
          ((m.screens || []).length || (m.fileCount || 0) > 0 || !m.children?.length)
        ) {
          seen.add(key);
          screens.push({ name, path: m.path || name, rank: navRank(name) });
        }
      }
      continue;
    }
    for (const m of t.modules || []) walk(m, 0);
  }
  if (uiRoot) {
    for (const l of deepModules?.leaves || []) {
      const sn = niceScreenName(l.name);
      const sk = sn.toLowerCase();
      if (sn && !seen.has(sk) && !/\.py$/i.test(String(l.name || ""))) {
        seen.add(sk);
        screens.push({ name: sn, path: l.path || sn, rank: navRank(sn) });
      }
    }
  }
  return screens;
}

function collectScreensFromFeatureTree(featureTree) {
  const screens = [];
  const seen = new Set();
  for (const t of featureTree || []) {
    for (const m of t.modules || []) {
      const name = niceScreenName(m.name);
      const key = name.toLowerCase();
      if (name && !seen.has(key)) {
        seen.add(key);
        screens.push({ name, path: m.path || name, rank: navRank(name) });
      }
      for (const inc of m.includes || []) {
        const iname = niceScreenName(inc);
        const ik = iname.toLowerCase();
        if (iname && !seen.has(ik)) {
          seen.add(ik);
          screens.push({ name: iname, path: iname, rank: navRank(iname) + 5 });
        }
      }
    }
  }
  return screens;
}

function collectScreensFromMvc(mvc) {
  const screens = [];
  const seen = new Set();
  for (const c of mvc?.controllers || []) {
    const name = titleCase(c.name);
    const key = name.toLowerCase();
    if (!seen.has(key) && !/^(home|login|error|account)$/i.test(c.name)) {
      seen.add(key);
      screens.push({ name, path: c.file || c.name, rank: navRank(c.name) });
    }
  }
  // Always try login first if present
  for (const c of mvc?.controllers || []) {
    if (/^login|account$/i.test(c.name)) {
      const name = titleCase(c.name);
      screens.unshift({ name, path: c.file || c.name, rank: 0 });
    }
  }
  return screens;
}

function extractGoRouterPaths(content) {
  const paths = [];
  for (const m of content.matchAll(/(?:path|name)\s*:\s*['"]\/?([A-Za-z0-9_\-\/]+)['"]/g)) {
    const seg = m[1].split("/").filter(Boolean).pop();
    if (seg && seg.length > 1) paths.push(niceScreenName(seg));
  }
  for (const m of content.matchAll(/GoRoute\s*\([\s\S]{0,120}?path:\s*['"]\/?([^'"]+)['"]/g)) {
    const seg = m[1].split("/").filter(Boolean).pop();
    if (seg) paths.push(niceScreenName(seg));
  }
  return paths;
}

function nodeToNavTree(node, depth = 0) {
  if (!node || depth > 6) return null;
  const name = niceScreenName(node.name || "");
  if (!name || /^(file|index|layout|widgets?|components?)$/i.test(name)) return null;
  if (/middleware|repository|helper|util/i.test(name) && depth > 0) return null;

  const childNodes = [];
  for (const c of node.children || []) {
    const child = nodeToNavTree(c, depth + 1);
    if (child) childNodes.push(child);
  }
  // Promote screen files as leaves under this feature
  for (const s of node.screens || []) {
    const sn = niceScreenName(s.name || s.file || "");
    if (
      sn &&
      !/^(file|index|layout)$/i.test(sn) &&
      !/\.(py|js|ts|cs)$/i.test(String(s.name || ""))
    ) {
      childNodes.push({ name: sn, children: [] });
    }
  }

  // Dedupe children by name
  const seen = new Set();
  const children = [];
  for (const c of childNodes) {
    const k = c.name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    children.push(c);
  }

  return { name, children };
}

/**
 * Branched navigation tree (splash → auth → home → feature branches), evidence only.
 */
export function buildNavigationTree(deepModules, featureTree, mvc) {
  const roots = [];

  const uiTrees = (deepModules?.tree || []).filter((t) =>
    /screen|feature|page|view/i.test(t.root || "")
  );

  if (uiTrees.length) {
    for (const t of uiTrees) {
      for (const m of t.modules || []) {
        const n = nodeToNavTree(m, 0);
        if (n) roots.push(n);
      }
    }
  } else if ((featureTree || []).length) {
    for (const t of featureTree) {
      for (const m of t.modules || []) {
        const children = (m.includes || [])
          .map((inc) => ({ name: niceScreenName(inc), children: [] }))
          .filter((c) => c.name);
        roots.push({
          name: niceScreenName(m.name),
          children: children.slice(0, 12),
        });
      }
    }
  } else if ((mvc?.controllers || []).length) {
    // Group: Auth-ish first, then others as siblings under App
    const auth = [];
    const rest = [];
    for (const c of mvc.controllers) {
      const name = titleCase(c.name);
      if (/login|account|auth/i.test(c.name)) auth.push({ name, children: [] });
      else if (!/error|home/i.test(c.name)) rest.push({ name, children: [] });
      else if (/home/i.test(c.name)) rest.unshift({ name, children: [] });
    }
    if (auth.length || rest.length) {
      roots.push({
        name: "App",
        children: [...auth, ...rest.slice(0, 20)],
      });
    }
  }

  // Sort top-level: splash/auth/home first
  roots.sort((a, b) => navRank(a.name) - navRank(b.name) || a.name.localeCompare(b.name));

  // Flatten pattern for accessibility / fallback
  const path = [];
  function walk(n) {
    if (!n || path.length >= 24) return;
    path.push(n.name);
    for (const c of n.children || []) walk(c);
  }
  for (const r of roots.slice(0, 12)) walk(r);

  return {
    tree: roots.slice(0, 20),
    path,
    pattern: path.length ? path.join(" → ") : null,
  };
}

/**
 * @returns {{
 *   roles: string[],
 *   permissions: string[],
 *   navigation: { path: string[], pattern: string|null },
 *   evidence: string[],
 *   notes: string[],
 *   roleCount: number,
 *   permissionCount: number
 * }}
 */
export async function collectAccessAndNavigationFromDisk(
  extractRoot,
  { deepModules, featureTree, mvc, apis, databaseAnalysis } = {}
) {
  const roles = new Map();
  const permissions = new Map();
  const evidence = [];

  const files = await collectCandidateFiles(extractRoot);
  let routerScreens = [];
  for (const f of files) {
    let content = "";
    try {
      const buf = await fs.readFile(f.abs);
      if (buf.length > MAX_FILE_BYTES) continue;
      content = buf.toString("utf8");
    } catch {
      continue;
    }
    if (ROLE_FILE_HINT.test(f.rel) || /Authorize|Permission|Role\./i.test(content)) {
      extractRolesAndPermissions(content, f.rel, roles, permissions, evidence);
    }
    if (/gorouter|GoRoute|routes\.dart|app_router/i.test(f.rel + content.slice(0, 200))) {
      routerScreens.push(...extractGoRouterPaths(content));
    }
  }

  extractRolesFromApis(apis, roles, permissions, evidence);
  extractFromDbAnalysis(databaseAnalysis, roles, permissions, evidence);

  // Controllers named RoleMaster / UserPermission are evidence of modules, not role values
  for (const c of mvc?.controllers || []) {
    if (/^role|permission/i.test(c.name)) {
      evidence.push(`mvc-controller:${c.name}`);
    }
  }

  const navigation = buildNavigationTree(deepModules, featureTree, mvc);

  // Drop boolean/flag-looking false positives from code scrape (e.g. IsClosed)
  const roleList = [...roles.values()]
    .filter((r) => !/^is[A-Z_]|^has[A-Z_]|^can[A-Z_]/i.test(r) && !/^(closed|active|deleted|enabled)$/i.test(r))
    .sort((a, b) => a.localeCompare(b));
  const permList = [...permissions.values()].sort((a, b) => a.localeCompare(b));

  const notes = [];
  if (!roleList.length) {
    notes.push(
      "No role names proven in code yet. Connect a live database on the Database step to read Role/Permission table values."
    );
  }
  if (!permList.length) {
    notes.push(
      "No permission keys proven in code yet. Live DB permission tables are preferred when available."
    );
  }
  if (!(navigation.tree || []).length) {
    notes.push("No screen / route navigation tree proven in this scan.");
  } else if ((deepModules?.tree || []).some((t) => /screen|feature|page/i.test(t.root || ""))) {
    notes.push("Navigation tree from screen/feature folders on disk (branched, not a flat controller list).");
  } else {
    notes.push(
      "No UI screen tree found — showing feature/controller areas as a branched map when possible."
    );
  }

  return {
    roles: roleList,
    permissions: permList,
    roleCount: roleList.length,
    permissionCount: permList.length,
    rolesSource: "code",
    permissionsSource: "code",
    navigation,
    evidence: [...new Set(evidence)].slice(0, 40),
    notes,
    dbReady: false,
  };
}

/**
 * Prefer live DB role/permission values when present; keep navigation from disk.
 */
export function mergeAccessNavWithDatabase(accessNav, databaseAnalysis, dbAccess = null) {
  const base = accessNav && typeof accessNav === "object"
    ? { ...accessNav, navigation: { ...(accessNav.navigation || {}) } }
    : {
        roles: [],
        permissions: [],
        roleCount: 0,
        permissionCount: 0,
        navigation: { path: [], pattern: null, tree: [] },
        evidence: [],
        notes: [],
      };

  const evidence = [...(base.evidence || [])];
  const notes = [];

  let roles = [...(base.roles || [])];
  let permissions = [...(base.permissions || [])];
  let rolesSource = base.rolesSource || "code";
  let permissionsSource = base.permissionsSource || "code";

  if (dbAccess && (dbAccess.roles?.length || dbAccess.permissions?.length || dbAccess.evidence?.length)) {
    if (dbAccess.roles?.length) {
      roles = dbAccess.roles;
      rolesSource = "database";
    }
    if (dbAccess.permissions?.length) {
      permissions = dbAccess.permissions;
      permissionsSource = "database";
    }
    evidence.push(...(dbAccess.evidence || []));
    notes.push(...(dbAccess.notes || []));
    notes.push("Roles/permissions prefer live database values when Role/Permission tables exist.");
  } else {
    extractFromDbAnalysis(databaseAnalysis, new Map(), new Map(), evidence);
    notes.push(
      "Analyze database completed, but no Role/Permission table values were read. Check table names (Role, RoleMaster, Permission, …)."
    );
    notes.push(...(base.notes || []).filter((n) => !/Connect a live database/i.test(n)));
  }

  if (!(base.navigation?.tree || []).length && !(base.navigation?.path || []).length) {
    notes.push("No screen navigation tree from disk scan.");
  }

  return {
    ...base,
    roles,
    permissions,
    roleCount: roles.length,
    permissionCount: permissions.length,
    rolesSource,
    permissionsSource,
    evidence: [...new Set(evidence)].slice(0, 50),
    notes: [...new Set(notes.filter(Boolean))],
    dbReady: true,
  };
}
