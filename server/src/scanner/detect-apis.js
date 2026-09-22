import {
  API_PATTERNS,
  NEXT_APP_ROUTE,
  NEXT_PAGES_API,
  OPENAPI_PATH_RE,
} from "./rules/apis.js";
import { MAX_API_RESULTS } from "./constants.js";
import {
  buildFlutterEndpointMap,
  flutterApisFromMap,
} from "./detect-flutter-apis.js";

function normalizeMethod(m) {
  if (!m) return "GET";
  const up = String(m).toUpperCase();
  if (up === "REQUEST" || up === "ALL" || up === "ANY" || up === "METHODS") return "ALL";
  return up.replace(/^HTTP/, "");
}

function normalizePath(p) {
  if (!p || p === "") return "/";
  let path = p.trim();
  if (!path.startsWith("/") && !path.startsWith("http")) path = "/" + path;
  return path.replace(/\/{2,}/g, "/");
}

function apiKey(method, path) {
  return `${method} ${path}`;
}

function isUnresolvedClientPath(p) {
  return /\$\{|Endpoints\.|ApiConstants\./.test(p);
}

/**
 * Detect HTTP APIs / routes across stacks.
 */
export function detectApis(files) {
  const found = new Map();

  function add(method, path, file, note, name) {
    if (found.size >= MAX_API_RESULTS) return;
    if (isUnresolvedClientPath(path)) return;
    const m = normalizeMethod(method);
    const p = normalizePath(path);
    if (p.length > 300) return;
    if (/node_modules|^\s*$/.test(p)) return;
    if (!p.startsWith("/") && !p.startsWith("http")) return;
    // Flutter named endpoints: keep each constant even if paths collide
    const key = name ? `name:${name}` : apiKey(m, p);
    if (!found.has(key)) {
      found.set(key, {
        method: m,
        path: p,
        file,
        ...(name ? { name } : {}),
        ...(note ? { note } : {}),
      });
    }
  }

  // --- Flutter first (authoritative for Dart endpoint catalogs) ---
  const { endpointMap, methodHints } = buildFlutterEndpointMap(files);
  if (endpointMap.size > 0) {
    for (const api of flutterApisFromMap(endpointMap, methodHints)) {
      add(api.method, api.path, api.file, api.note, api.name);
    }
  }

  for (const f of files) {
    const norm = f.rel.replace(/\\/g, "/");

    // Next.js App Router API routes
    const appRoute = norm.match(NEXT_APP_ROUTE);
    if (appRoute) {
      const routePath = "/" + appRoute[1].replace(/\[([^\]]+)\]/g, ":$1");
      const methods = new Set();
      if (f.content) {
        for (const m of f.content.matchAll(
          /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g
        )) {
          methods.add(m[1]);
        }
        for (const m of f.content.matchAll(
          /export\s+const\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s*=/g
        )) {
          methods.add(m[1]);
        }
      }
      if (methods.size === 0) methods.add("ALL");
      for (const m of methods) add(m, routePath, norm, "Next.js App Router");
    }

    const pagesApi = norm.match(NEXT_PAGES_API);
    if (pagesApi) {
      let routePath = "/api/" + pagesApi[1].replace(/\\/g, "/");
      routePath = routePath.replace(/\/index$/i, "").replace(/\[([^\]]+)\]/g, ":$1");
      add("ALL", routePath, norm, "Next.js Pages API");
    }

    if (/openapi|swagger/i.test(f.base) && f.content) {
      for (const m of f.content.matchAll(/['"](\/[^'"]+)['"]\s*:\s*\{([\s\S]*?)\}/g)) {
        const path = m[1];
        const body = m[2].slice(0, 500);
        for (const method of ["get", "post", "put", "patch", "delete", "options", "head"]) {
          if (new RegExp(`\\b${method}\\s*:`, "i").test(body)) {
            add(method, path, norm, "OpenAPI");
          }
        }
      }
      for (const m of f.content.matchAll(OPENAPI_PATH_RE)) {
        add(m[2], m[1], norm, "OpenAPI");
      }
    }

    if (!f.content) continue;

    // Skip generic .post("...") pattern on Dart when we already resolved Endpoints
    const skipDartGeneric = f.ext === ".dart" && endpointMap.size > 0;

    for (const pattern of API_PATTERNS) {
      if (pattern.onlyIfPath && !pattern.onlyIfPath.test(norm)) continue;
      if (skipDartGeneric && pattern.framework === "Go HTTP") continue;
      if (skipDartGeneric && pattern.clientOnly) continue;

      const re = new RegExp(pattern.re.source, pattern.re.flags);
      let match;
      while ((match = re.exec(f.content)) !== null) {
        if (pattern.methodFixed && pattern.pathGroup) {
          add(pattern.methodFixed, match[pattern.pathGroup], norm, pattern.framework);
          continue;
        }
        if (pattern.methodFromDecorator) {
          const decorator = match[0].match(/@(\w+)/);
          const method = decorator ? decorator[1] : "GET";
          const path = match[pattern.pathGroup || 1];
          add(method, path, norm, pattern.framework);
          continue;
        }
        if (pattern.pathFallback && match[1] && !match[2]) {
          add(match[1], pattern.pathFallback, norm, pattern.framework);
          continue;
        }
        const method = match[1];
        const path = match[2];
        if (!path) continue;
        add(method, path, norm, pattern.clientOnly ? "client call" : pattern.framework);
      }
    }

    if (f.ext === ".cs") {
      for (const m of f.content.matchAll(/\[Route\s*\(\s*['"`]([^'"`]+)['"`]\s*\)\]/gi)) {
        add("ALL", m[1].startsWith("/") ? m[1] : "/" + m[1], norm, "ASP.NET Route");
      }
    }

    if (f.ext === ".dart" || f.ext === ".ts" || f.ext === ".tsx" || f.ext === ".js") {
      for (const m of f.content.matchAll(
        /(?:baseUrl|baseURL|BASE_URL)\s*[:=]\s*['"`]((?:https?:\/\/|\/)[^'"`]+)['"`]/g
      )) {
        // base URL itself is not an API route — skip
        void m;
      }
    }
  }

  // Prefer concrete methods over ALL when same path+no name
  const list = [...found.values()];
  return list.sort((a, b) => {
    if (a.path === b.path) {
      if (a.name && b.name) return a.name.localeCompare(b.name);
      return a.method.localeCompare(b.method);
    }
    return a.path.localeCompare(b.path);
  });
}
