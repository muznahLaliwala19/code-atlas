import fs from "fs/promises";
import path from "path";

const CONTROLLER_SKIP = /^BaseController\.cs$/i;

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
      if (entry.name.startsWith(".") && entry.name !== ".github") continue;
      if (entry.isDirectory()) {
        if (["node_modules", "bin", "obj", "packages", ".git"].includes(entry.name)) continue;
        await walk(path.join(abs, entry.name), rel ? `${rel}/${entry.name}` : entry.name);
        continue;
      }
      if (!entry.isFile()) continue;
      const norm = (rel ? `${rel}/` : "") + entry.name;
      out.push({
        abs: path.join(abs, entry.name),
        rel: norm.replace(/\\/g, "/"),
        base: entry.name,
        ext: path.extname(entry.name).toLowerCase(),
      });
    }
  }
  await walk(rootDir, "");
  return out;
}

function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

function controllerShortName(fileName) {
  return fileName.replace(/Controller\.cs$/i, "");
}

function parseDefaultRoutePattern(programContent) {
  const m = programContent.match(
    /MapControllerRoute\s*\([\s\S]*?pattern\s*:\s*["']([^"']+)["']/i
  );
  if (m) return m[1];
  const m2 = programContent.match(
    /MapDefaultControllerRoute\s*\(\s*\)/
  );
  if (m2) return "{controller=Home}/{action=Index}/{id?}";
  return "{controller}/{action}/{id?}";
}

function buildConventionalPath(controllerName, actionName, pattern) {
  const ctrl = controllerShortName(controllerName);
  let pathStr = pattern
    .replace(/\{controller(?:=[^}]+)?\}/gi, ctrl)
    .replace(/\{action(?:=[^}]+)?\}/gi, actionName)
    .replace(/\{id\??\}/gi, "")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
  if (!pathStr.startsWith("/")) pathStr = `/${pathStr}`;
  return pathStr;
}

function resolveRouteTemplate(template, controllerName, actionName) {
  if (!template) return null;
  let t = template;
  if (/\[controller\]/i.test(t)) {
    t = t.replace(/\[controller\]/gi, controllerShortName(controllerName));
  }
  if (/\[action\]/i.test(t)) {
    t = t.replace(/\[action\]/gi, actionName);
  }
  if (!t.startsWith("/")) t = `/${t}`;
  return t.replace(/\/{2,}/g, "/");
}

function detectHttpMethod(attrBlock, bodySnippet, hasFromBody) {
  const block = attrBlock || "";
  const m = block.match(/\[Http(Get|Post|Put|Patch|Delete|Head|Options)/i);
  if (m) return m[1].toUpperCase();
  if (/\[AcceptVerbs\s*\(\s*["']POST["']/i.test(block)) return "POST";
  if (hasFromBody) return "POST";
  if (/return\s+Json\s*\(/i.test(bodySnippet)) return "POST";
  return "GET";
}

function detectReturnKind(bodySnippet) {
  if (/return\s+View\s*\(/i.test(bodySnippet)) return "page";
  if (/return\s+PartialView\s*\(/i.test(bodySnippet)) return "partial";
  if (/return\s+Json\s*\(/i.test(bodySnippet) || /return\s+Ok\s*\(/i.test(bodySnippet)) {
    return "api";
  }
  if (/return\s+Redirect/i.test(bodySnippet)) return "redirect";
  if (/return\s+File\s*\(/i.test(bodySnippet)) return "file";
  return "action";
}

function extractActionMethods(content, controllerFile) {
  const controllerName = controllerShortName(path.basename(controllerFile));
  const clean = stripComments(content);
  const actions = [];
  const seen = new Set();

  const classRouteMatch = clean.match(/\[Route\s*\(\s*["']([^"']+)["']\s*\)\]/i);
  const classRoute = classRouteMatch ? classRouteMatch[1] : "";

  const re =
    /((?:\[[^\]]+\]\s*)*)\s*public\s+(?:async\s+)?(?:virtual\s+)?(?:override\s+)?(?:[\w<>,.?[\]\s]+)\s+(\w+)\s*\(([^)]*)\)\s*\{/g;

  let m;
  while ((m = re.exec(clean)) !== null) {
    const attrBlock = m[1] || "";
    const actionName = m[2];
    const params = m[3] || "";

    if (
      actionName === controllerName ||
      actionName.startsWith("get_") ||
      actionName.startsWith("set_") ||
      /^(Equals|GetHashCode|ToString)$/.test(actionName)
    ) {
      continue;
    }

    const bodyStart = m.index + m[0].length;
    const bodySnippet = clean.slice(bodyStart, bodyStart + 1200);
    const hasFromBody = /\[FromBody\]/.test(params);
    const method = detectHttpMethod(attrBlock, bodySnippet, hasFromBody);
    const returnKind = detectReturnKind(bodySnippet);

    let actionRoute = "";
    const routeAttr = attrBlock.match(/\[Route\s*\(\s*["']([^"']+)["']\s*\)\]/i);
    if (routeAttr) actionRoute = routeAttr[1];

    const httpPathAttr = attrBlock.match(
      /\[Http(?:Get|Post|Put|Patch|Delete|Head|Options)\s*\(\s*["']([^"']*)["']\s*\)\]/i
    );
    if (httpPathAttr && httpPathAttr[1]) actionRoute = httpPathAttr[1];

    let routePath;
    if (actionRoute) {
      const merged = classRoute
        ? `${classRoute.replace(/\/$/, "")}/${actionRoute.replace(/^\//, "")}`
        : actionRoute;
      routePath = resolveRouteTemplate(merged, controllerName, actionName);
    }

    const type =
      returnKind === "api" || hasFromBody || (method !== "GET" && returnKind === "action")
        ? "api"
        : returnKind === "page" || returnKind === "partial"
          ? "page"
          : returnKind;

    if (!routePath) {
      routePath = buildConventionalPath(controllerName, actionName, "{controller}/{action}/{id?}");
    }

    const key = `${actionName}|${method}|${routePath}`;
    if (seen.has(key)) continue;
    seen.add(key);

    actions.push({
      name: actionName,
      method,
      path: routePath,
      type,
      hasFromBody,
      returnKind,
      params: params.trim().slice(0, 200) || null,
    });
  }

  return { controllerName, classRoute, actions };
}

async function indexViews(rootDir, allFiles) {
  const map = new Map();
  for (const f of allFiles) {
    if (f.ext !== ".cshtml") continue;
    const norm = f.rel.replace(/\\/g, "/");
    const m = norm.match(/(?:^|\/)Views\/([^/]+)\/([^/]+)\.cshtml$/i);
    if (!m) continue;
    map.set(`${m[1].toLowerCase()}|${m[2].toLowerCase()}`, norm);
    const shared = norm.match(/(?:^|\/)Views\/Shared\/([^/]+)\.cshtml$/i);
    if (shared) map.set(`shared|${shared[1].toLowerCase()}`, norm);
  }
  return map;
}

function linkView(viewIndex, controllerName, actionName) {
  const key = `${controllerShortName(controllerName).toLowerCase()}|${actionName.toLowerCase()}`;
  return viewIndex.get(key) || null;
}

/**
 * Full ASP.NET Core MVC structure: controllers → actions → views + API endpoints.
 * Uses real Controller/Action names — never invents placeholder routes.
 */
export async function collectMvcStructureFromDisk(rootDir) {
  const allFiles = await walkAllFiles(rootDir);
  const viewIndex = await indexViews(rootDir, allFiles);

  let routePattern = "{controller}/{action}/{id?}";
  for (const f of allFiles) {
    if (!/^program\.cs$/i.test(f.base)) continue;
    try {
      const content = await fs.readFile(f.abs, "utf8");
      routePattern = parseDefaultRoutePattern(content);
    } catch {
      /* skip */
    }
  }

  const controllers = [];
  const apis = [];

  for (const f of allFiles) {
    if (!/Controller\.cs$/i.test(f.base) || CONTROLLER_SKIP.test(f.base)) continue;

    let content = "";
    try {
      content = await fs.readFile(f.abs, "utf8");
    } catch {
      continue;
    }

    const parsed = extractActionMethods(content, f.rel);
    if (!parsed.actions.length) continue;

    const actions = parsed.actions.map((a) => {
      const view =
        a.type === "page" || a.type === "partial"
          ? linkView(viewIndex, parsed.controllerName, a.name)
          : null;
      const path =
        a.path ||
        buildConventionalPath(parsed.controllerName, a.name, routePattern);

      const entry = {
        ...a,
        path,
        view,
        controller: parsed.controllerName,
        file: f.rel,
      };

      if (a.type === "api" || a.hasFromBody || /Json|Ok\s*\(/i.test(a.returnKind || "")) {
        apis.push({
          method: a.method,
          path,
          file: f.rel,
          name: `${parsed.controllerName}.${a.name}`,
          type: "api",
          action: a.name,
          controller: parsed.controllerName,
        });
      }

      return entry;
    });

    controllers.push({
      name: parsed.controllerName,
      file: f.rel,
      classRoute: parsed.classRoute || null,
      actionCount: actions.length,
      actions,
    });
  }

  controllers.sort((a, b) => a.name.localeCompare(b.name));
  apis.sort((a, b) => String(a.path).localeCompare(String(b.path)));

  return {
    routePattern,
    controllers,
    apis,
    controllerCount: controllers.length,
    actionCount: controllers.reduce((n, c) => n + c.actions.length, 0),
    viewLinkedCount: controllers.reduce(
      (n, c) => n + c.actions.filter((a) => a.view).length,
      0
    ),
  };
}

/**
 * Build module tree nodes: Controller → Action (with linked .cshtml).
 */
export function buildMvcModuleTree(mvc) {
  if (!mvc?.controllers?.length) return null;

  const modules = mvc.controllers.map((ctrl) => ({
    name: ctrl.name,
    path: ctrl.name.toLowerCase(),
    screens: [{ file: ctrl.file, name: path.basename(ctrl.file), kind: "controller" }],
    screenKinds: ["controller"],
    children: ctrl.actions.map((action) => ({
      name: action.name,
      path: `${ctrl.name.toLowerCase()}/${action.name}`,
      screens: action.view
        ? [{ file: action.view, name: path.basename(action.view), kind: "page" }]
        : [{ file: ctrl.file, name: action.name, kind: action.type === "api" ? "api" : "action" }],
      screenKinds: [
        action.type === "api" ? "api" : action.view ? "page" : action.type,
      ],
      children: [],
      fileCount: 1,
      mvc: {
        method: action.method,
        path: action.path,
        type: action.type,
        view: action.view,
      },
    })),
    fileCount: ctrl.actions.length,
  }));

  const flat = [];
  for (const c of modules) {
    flat.push(c.path);
    for (const a of c.children) flat.push(a.path);
  }

  return {
    root: "Controllers (MVC)",
    priority: 25,
    quality: modules.length * 8 + flat.length * 2,
    modules,
    flat,
  };
}
