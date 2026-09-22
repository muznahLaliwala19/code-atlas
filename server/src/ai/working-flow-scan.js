/**
 * Evidence-based working flow:
 * open menus → controller/action code → stored procedures / CRUD → tables.
 * Only modules with real DB wiring are included (not empty / dead menus).
 */

import fs from "fs/promises";
import path from "path";

const SKIP_DIRS = new Set([
  "node_modules",
  "bin",
  "obj",
  "wwwroot",
  "plugins",
  ".git",
  "packages",
]);

const INFRA = new Set([
  "home",
  "login",
  "error",
  "common",
  "fileupload",
  "page",
  "menumaster",
  "user",
  "userpermission",
  "rolemaster",
  "mapping",
  "supportlicense",
  "base",
  "account",
]);

const FMS_ORDER = [
  "budgetsetup",
  "budget",
  "limitallocation",
  "limitrequest",
  "limittransfer",
  "limitreversal",
  "beneficiary",
  "expenditure",
  "bulkexpenditure",
  "limitsurrender",
  "cashbook",
  "payment",
  "misreport",
  "reports",
  "report",
];

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/controller$/i, "")
    .replace(/[^a-z0-9]+/g, "");
}

function titleCase(id) {
  return String(id || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/** Remove // and /* *\/ comments so dead/commented SP calls are ignored */
function stripComments(src) {
  return String(src || "")
    .replace(/\/\*[\s\S]*?\*\//g, "\n")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

async function walk(rootDir) {
  const out = [];
  async function rec(abs, rel) {
    let entries;
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") && e.name !== ".github") continue;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        await rec(path.join(abs, e.name), rel ? `${rel}/${e.name}` : e.name);
        continue;
      }
      if (!e.isFile()) continue;
      const ext = path.extname(e.name).toLowerCase();
      out.push({
        abs: path.join(abs, e.name),
        rel: ((rel ? `${rel}/` : "") + e.name).replace(/\\/g, "/"),
        base: e.name,
        ext,
      });
    }
  }
  await rec(rootDir, "");
  return out;
}

async function readText(abs, max = 250_000) {
  try {
    const st = await fs.stat(abs);
    if (st.size > max) return "";
    const t = await fs.readFile(abs, "utf8");
    if (!t || t.includes("\u0000")) return "";
    return t;
  } catch {
    return "";
  }
}

function extractStoredProcs(code) {
  const live = stripComments(code);
  const names = new Set();
  const patterns = [
    /Query(?:Async|FirstOrDefaultAsync|MultipleAsync)?\s*(?:<[^>]*>)?\s*\(\s*["']([^"']+)["']/g,
    /Execute(?:Async)?\s*(?:<[^>]*>)?\s*\(\s*["']([^"']+)["']/g,
    /commandType:\s*CommandType\.StoredProcedure[\s\S]{0,120}?["']([^"']+)["']/gi,
    /\(\s*["']([A-Za-z_][\w]*)["']\s*,\s*param\s*,\s*commandType:\s*CommandType\.StoredProcedure/g,
    /\.StoredProcedure\s*[,\)][\s\S]{0,60}?["']([A-Za-z_][\w]*)["']/g,
  ];
  for (const re of patterns) {
    let m;
    const r = new RegExp(re.source, re.flags);
    while ((m = r.exec(live)) !== null) {
      const name = m[1];
      if (!name) continue;
      if (/^(select|insert|update|delete|with|declare)\b/i.test(name)) continue;
      if (name.length < 3) continue;
      names.add(name);
    }
  }
  return [...names];
}

function extractCrudAndTables(code) {
  const live = stripComments(code);
  const crud = [];
  const tables = new Set();

  const addTable = (t) => {
    if (!t) return;
    let name = String(t).replace(/[\[\]`"]/g, "");
    if (name.includes(".")) name = name.split(".").pop();
    if (!/^[A-Za-z_][\w]*$/.test(name)) return;
    if (
      /^(dbo|select|from|where|into|set|values|join|as|on|and|or|null|table)$/i.test(name)
    )
      return;
    if (/(Controller|Repository|Service|ViewModel|DbContext)$/i.test(name)) return;
    tables.add(name);
  };

  const sqlOps = [
    { op: "INSERT", re: /\bINSERT\s+INTO\s+([\[\]\w.]+)/gi },
    { op: "UPDATE", re: /\bUPDATE\s+([\[\]\w.]+)\s+SET\b/gi },
    { op: "DELETE", re: /\bDELETE\s+FROM\s+([\[\]\w.]+)/gi },
    { op: "SELECT", re: /\bFROM\s+([\[\]\w.]+)/gi },
  ];
  for (const { op, re } of sqlOps) {
    let m;
    while ((m = re.exec(live)) !== null) {
      addTable(m[1]);
      if (op !== "SELECT") crud.push({ op, table: String(m[1]).replace(/[\[\]`"]/g, "").split(".").pop() });
    }
  }

  // Entity / table attribute hints
  let m;
  const entityRe = /\[Table\s*\(\s*["']([^"']+)["']\s*\)\]/gi;
  while ((m = entityRe.exec(live)) !== null) addTable(m[1]);

  const classRe =
    /public\s+class\s+(LimitHistoryLog|SchemeAllocation\w*|Beneficiary\w*|Expenditure\w*|Budget\w*)\b/g;
  while ((m = classRe.exec(live)) !== null) {
    if (!/(Controller|Repository|Service)$/i.test(m[1])) addTable(m[1]);
  }

  return { crud, tables: [...tables] };
}

function extractMenusFromText(content, rel) {
  const menus = [];
  const live = stripComments(content);

  const push = (controller, action, label, extra = {}) => {
    const c = String(controller || "").replace(/Controller$/i, "").trim();
    const a = String(action || "Index").trim();
    if (!c) return;
    if (INFRA.has(norm(c))) return;
    menus.push({
      name: label || titleCase(c),
      controller: c,
      action: a,
      source: rel,
      ...extra,
    });
  };

  // asp-controller / asp-action
  let m;
  const aspRe =
    /asp-controller\s*=\s*["']([^"']+)["'][^>]*asp-action\s*=\s*["']([^"']+)["']|asp-action\s*=\s*["']([^"']+)["'][^>]*asp-controller\s*=\s*["']([^"']+)["']/gi;
  while ((m = aspRe.exec(live)) !== null) {
    push(m[1] || m[4], m[2] || m[3], null);
  }

  // Url.Action("Action", "Controller")
  const urlRe = /Url\.Action\s*\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']/g;
  while ((m = urlRe.exec(live)) !== null) {
    push(m[2], m[1], null);
  }

  // new { controller = "X", action = "Y" } or ControllerName / ActionName assignments
  const objRe = /controller\s*=\s*["']([^"']+)["']\s*,\s*action\s*=\s*["']([^"']+)["']/gi;
  while ((m = objRe.exec(live)) !== null) {
    push(m[1], m[2], null);
  }

  // Menu seed / MenuMaster style: ControllerName = "LimitAllocation"
  const ctrlNameRe = /ControllerName\s*=\s*["']([^"']+)["']/gi;
  while ((m = ctrlNameRe.exec(live)) !== null) {
    const nearby = live.slice(Math.max(0, m.index - 200), m.index + 200);
    const act = nearby.match(/ActionName\s*=\s*["']([^"']+)["']/i);
    const label = nearby.match(/(?:MenuName|Title|DisplayName|Name)\s*=\s*["']([^"']+)["']/i);
    // Prefer active menus when flag present nearby
    if (/IsActive\s*=\s*false|IsDeleted\s*=\s*true|Status\s*=\s*0/i.test(nearby)) continue;
    push(m[1], act?.[1] || "Index", label?.[1] || null, { fromMenuMaster: true });
  }

  // href="/Controller/Action"
  const hrefRe = /href\s*=\s*["']\/([A-Za-z][\w]*)\/([A-Za-z][\w]*)/g;
  while ((m = hrefRe.exec(live)) !== null) {
    push(m[1], m[2], null);
  }

  // Flutter / Dart drawer or GoRoute path segments
  if (/\.dart$/i.test(rel)) {
    const routeRe = /(?:path|name)\s*:\s*['"]\/?([a-z][\w/-]+)['"]/gi;
    while ((m = routeRe.exec(live)) !== null) {
      const seg = m[1].split("/").filter(Boolean).pop();
      if (!seg || INFRA.has(norm(seg)) || seg.length < 3) continue;
      menus.push({
        name: titleCase(seg),
        controller: seg,
        action: "open",
        source: rel,
        stack: "flutter",
      });
    }
  }

  return menus;
}

function scoreRepoForController(rel, controllerNorm) {
  const r = rel.toLowerCase().replace(/\\/g, "/");
  const base = r.split("/").pop() || "";
  let s = 0;

  // Strong: file/folder named for this controller
  if (base.includes(controllerNorm)) s += 80;
  if (r.includes(`/${controllerNorm}/`) || r.includes(`/${controllerNorm}`)) s += 50;

  // Controllers
  if (/controllers\//i.test(r) && base.includes(controllerNorm)) s += 40;

  // Repositories only if named for this module (or Common* for FMS domains)
  if (/repositor/i.test(r)) {
    if (base.includes(controllerNorm) || r.includes(`/${controllerNorm}`)) s += 70;
    else if (
      /commonrepository/i.test(base) &&
      /limit|expenditure|budget|cashbook|beneficiar|surrender|reversal/i.test(controllerNorm)
    ) {
      s += 35;
    } else {
      return 0; // other modules' repositories — ignore
    }
  }

  if (/entity|models?\//i.test(r) && (base.includes(controllerNorm) || r.includes(controllerNorm)))
    s += 25;

  if (
    /limithistorylog/i.test(r) &&
    /limit|expenditure|budget|cashbook|surrender|reversal/i.test(controllerNorm)
  ) {
    s += 30;
  }

  return s;
}

function dedupeMenus(menus) {
  const map = new Map();
  for (const m of menus) {
    const key = `${norm(m.controller)}|${norm(m.action)}`;
    if (!map.has(key)) map.set(key, m);
    else if (m.fromMenuMaster) map.set(key, m);
  }
  return [...map.values()];
}

function sortWorking(mods) {
  return [...mods].sort((a, b) => {
    const ia = FMS_ORDER.indexOf(norm(a.id));
    const ib = FMS_ORDER.indexOf(norm(b.id));
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Scan extract root for menus + working CRUD/SP/table evidence.
 */
export async function collectWorkingFlowEvidence(rootDir, { mvcStructure } = {}) {
  const files = await walk(rootDir);
  const menusRaw = [];

  // 1) Open menus from layout / menu / seed / views
  for (const f of files) {
    if (!/\.(cshtml|cs|sql|json|dart|xml)$/i.test(f.ext)) continue;
    const rel = f.rel.toLowerCase();
    const likelyMenu =
      /menu|layout|sidebar|nav|drawer|_layout|menumaster|seed/i.test(rel) ||
      /\.(cshtml|sql|json|dart)$/i.test(f.ext);
    if (!likelyMenu && !/views\//i.test(rel)) continue;
    const content = await readText(f.abs);
    if (!content) continue;
    menusRaw.push(...extractMenusFromText(content, f.rel));
  }

  let menus = dedupeMenus(menusRaw);

  // 2) If few menus found, use MVC controllers that have at least one view-linked action
  if (menus.length < 3 && mvcStructure?.controllers?.length) {
    for (const c of mvcStructure.controllers) {
      if (INFRA.has(norm(c.name))) continue;
      const hasView = (c.actions || []).some((a) => a.view);
      if (!hasView && (c.actions || []).length === 0) continue;
      menus.push({
        name: titleCase(c.name),
        controller: c.name,
        action: (c.actions || []).find((a) => a.view)?.name || c.actions?.[0]?.name || "Index",
        source: "mvc-fallback",
      });
    }
    menus = dedupeMenus(menus);
  }

  // Group by controller
  const byController = new Map();
  for (const m of menus) {
    const key = norm(m.controller);
    if (!byController.has(key)) {
      byController.set(key, {
        id: key,
        name: m.name || titleCase(m.controller),
        controller: m.controller,
        menuActions: [],
        menuSources: [],
      });
    }
    const g = byController.get(key);
    g.menuActions.push(m.action);
    g.menuSources.push(m.source);
    if (m.fromMenuMaster) g.fromMenuMaster = true;
  }

  const workingModules = [];
  const skipped = [];
  const dataFlowEdges = [];

  for (const mod of byController.values()) {
    const cNorm = norm(mod.controller);

    // Find controller file + ranked related files
    const related = files
      .map((f) => ({ ...f, score: scoreRepoForController(f.rel, cNorm) }))
      .filter((f) => f.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 18);

    // Always include controller itself
    const controllerFiles = files.filter(
      (f) =>
        /controllers\//i.test(f.rel) &&
        norm(f.base.replace(/\.cs$/i, "").replace(/controller$/i, "")) === cNorm
    );

    const bundle = [];
    const seen = new Set();
    for (const f of [...controllerFiles, ...related]) {
      if (seen.has(f.rel)) continue;
      seen.add(f.rel);
      bundle.push(f);
    }

    const storedProcedures = new Set();
    const tables = new Set();
    const crud = [];
    const evidenceFiles = [];
    let hasRepoCall = false;

    for (const f of bundle) {
      const content = await readText(f.abs);
      if (!content) continue;
      const live = stripComments(content);
      evidenceFiles.push(f.rel);

      for (const sp of extractStoredProcs(content)) storedProcedures.add(sp);
      const { crud: cRows, tables: tRows } = extractCrudAndTables(content);
      crud.push(...cRows);
      for (const t of tRows) tables.add(t);

      if (
        /Repository|_repo|I[A-Z]\w*Repository|QueryAsync|ExecuteAsync|CommandType\.StoredProcedure/i.test(
          live
        )
      ) {
        hasRepoCall = true;
      }
    }

    const sps = [...storedProcedures];
    const tableList = [...tables];
    const working =
      sps.length > 0 ||
      crud.some((c) => c.op !== "SELECT") ||
      (hasRepoCall && tableList.length > 0);

    if (!working) {
      skipped.push({
        name: mod.name,
        controller: mod.controller,
        reason: "Open/linked in UI but no live SP/CRUD/table wiring found in code",
      });
      continue;
    }

    const detailParts = [];
    if (sps.length) detailParts.push(`SPs: ${sps.slice(0, 6).join(", ")}`);
    if (tableList.length) detailParts.push(`tables: ${tableList.slice(0, 6).join(", ")}`);
    const writeOps = [...new Set(crud.filter((c) => c.op !== "SELECT").map((c) => c.op))];
    if (writeOps.length) detailParts.push(`CRUD: ${writeOps.join("/")}`);

    workingModules.push({
      id: mod.id,
      name: titleCase(mod.controller),
      controller: mod.controller,
      menuActions: [...new Set(mod.menuActions)],
      storedProcedures: sps,
      tables: tableList,
      crud: crud.slice(0, 20),
      evidenceFiles: evidenceFiles.slice(0, 12),
      working: true,
      summary: detailParts.join(" · "),
    });

    // Data-flow edges (menu → code → SP/table)
    dataFlowEdges.push({
      from: `Menu: ${titleCase(mod.controller)}`,
      to: `${mod.controller}Controller`,
      via: "open menu",
      detail: `User opens ${titleCase(mod.controller)} from navigation`,
      evidence: mod.menuSources.slice(0, 2),
    });

    if (sps.length) {
      dataFlowEdges.push({
        from: `${mod.controller}Controller`,
        to: sps.slice(0, 4).join(", "),
        via: "StoredProcedure",
        detail: `Live SP calls from repository/controller (commented calls ignored)`,
        evidence: evidenceFiles.filter((e) => /repositor|controller/i.test(e)).slice(0, 3),
      });
      if (tableList.length) {
        dataFlowEdges.push({
          from: sps[0],
          to: tableList.slice(0, 5).join(", "),
          via: "SQL / SP body or entity",
          detail: `Persists/reads working tables used by this menu`,
          evidence: tableList.slice(0, 5),
        });
      }
    } else if (tableList.length) {
      dataFlowEdges.push({
        from: `${mod.controller}Controller`,
        to: tableList.slice(0, 5).join(", "),
        via: writeOps.length ? writeOps.join("/") : "SQL",
        detail: `Direct CRUD against tables`,
        evidence: evidenceFiles.slice(0, 3),
      });
    }
  }

  const ordered = sortWorking(workingModules);

  return {
    menus: menus.map((m) => ({
      name: m.name,
      controller: m.controller,
      action: m.action,
      source: m.source,
    })),
    workingModules: ordered,
    skipped,
    dataFlowEdges,
  };
}
