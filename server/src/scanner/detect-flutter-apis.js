/**
 * Flutter / Dart API detection:
 * 1) Parse Endpoints / ApiConstants style files (real paths)
 * 2) Resolve Dio/http calls that reference Endpoints.xyz
 * 3) Avoid showing raw "${Endpoints.foo}" as the path
 */

const SKIP_ENDPOINT_NAMES = new Set([
  "baseurl",
  "imgurl",
  "imageurl",
  "receivetimeout",
  "connectiontimeout",
  "connecttimeout",
  "islive",
  "appversion",
  "appversionandroid",
  "appversionios",
  "playstoreurl",
  "appstoreurl",
  "privacypolicyurl",
  "termsurl",
  "termsofuseurl",
  "filedownloadurl",
  "imagedownloadurl",
]);

function extractStringConsts(content) {
  const map = new Map();
  // static const String name = '...' / "..."
  const re =
    /(?:static\s+)?(?:const\s+)?String\s+(\w+)\s*=\s*(?:r)?(['"])([\s\S]*?)\2\s*;/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    map.set(m[1], m[3].replace(/\s+/g, ""));
  }
  return map;
}

function resolveInterpolations(raw, consts) {
  let out = raw;
  // ${baseUrl}Path or $baseUrl
  out = out.replace(/\$\{(\w+)\}/g, (_, name) => {
    if (consts.has(name)) return consts.get(name);
    return "";
  });
  out = out.replace(/\$(\w+)/g, (_, name) => {
    if (consts.has(name)) return consts.get(name);
    return "";
  });
  return out;
}

function toApiPath(resolved) {
  if (!resolved) return null;
  let p = resolved.trim();
  // full URL → keep path part preferred for display, but full URL ok
  if (/^https?:\/\//i.test(p)) {
    try {
      const u = new URL(p);
      const path = u.pathname + (u.search || "");
      return path === "/" ? p : path.endsWith("/") && path.length > 1 ? path.slice(0, -1) || path : path;
    } catch {
      return p;
    }
  }
  if (!p.startsWith("/")) p = "/" + p;
  return p.replace(/\/{2,}/g, "/");
}

function isLikelyApiEndpoint(name, resolved) {
  const n = name.toLowerCase();
  if (SKIP_ENDPOINT_NAMES.has(n)) return false;
  if (/timeout|version|url$|policy|store/i.test(n) && !/api|list|get|post|login|otp|report/i.test(n)) {
    if (/playstore|appstore|privacy|terms|version/i.test(n)) return false;
  }
  if (!resolved) return false;
  // must look like a route, not a bare host
  if (/^https?:\/\/[^/]+\/?$/i.test(resolved)) return false;
  // file CDN roots ending with Uploads/ only — skip pure asset roots
  if (/\/Uploads\/?$/i.test(resolved) && /img|image|file/i.test(n)) return false;
  return true;
}

/**
 * Build endpoint name → resolved path from Dart constant files.
 */
export function buildFlutterEndpointMap(files) {
  const endpointMap = new Map(); // name -> { path, file, raw }
  const methodHints = new Map(); // name -> method

  for (const f of files) {
    if (f.ext !== ".dart" || !f.content) continue;
    const norm = f.rel.replace(/\\/g, "/");
    const isEndpointFile =
      /endpoint/i.test(f.base) ||
      /api[_-]?constant/i.test(f.base) ||
      /routes?\.dart$/i.test(f.base) ||
      /class\s+Endpoints\b/.test(f.content);

    if (!isEndpointFile) continue;

    const consts = extractStringConsts(f.content);
    // Prefer resolving with local consts (baseUrl etc.)
    for (const [name, raw] of consts) {
      const resolved = resolveInterpolations(raw, consts);
      if (!isLikelyApiEndpoint(name, resolved)) continue;
      const path = toApiPath(resolved);
      if (!path || path === "/") continue;
      // Prefer paths that come from baseUrl APIs over imgUrl
      if (!endpointMap.has(name) || /\$\{?baseUrl\}?/i.test(raw)) {
        endpointMap.set(name, { path, file: norm, raw, name });
      }
    }
  }

  // Method hints from Dio / http client call sites
  for (const f of files) {
    if (f.ext !== ".dart" || !f.content) continue;
    const norm = f.rel.replace(/\\/g, "/");

    // _dioClient.post(Endpoints.login  OR  .post("${Endpoints.login}")
    const callRe =
      /\.(get|post|put|patch|delete|download|fetch)\s*\(\s*(?:['"`]\$\{?Endpoints\.(\w+)\}?['"`]|Endpoints\.(\w+)|ApiConstants\.(\w+)|API\.(\w+))/gi;
    let m;
    while ((m = callRe.exec(f.content)) !== null) {
      const method = m[1].toUpperCase() === "DOWNLOAD" ? "GET" : m[1].toUpperCase();
      const name = m[2] || m[3] || m[4] || m[5];
      if (!name) continue;
      if (!methodHints.has(name)) methodHints.set(name, { method, file: norm });
    }

    // Also: dio.get(Endpoints.x) via variable dio
    const dioRe =
      /\b(?:dio|httpClient|_dio|_client)\.(get|post|put|patch|delete)\s*\(\s*(?:['"`]\$\{?Endpoints\.(\w+)\}?['"`]|Endpoints\.(\w+))/gi;
    while ((m = dioRe.exec(f.content)) !== null) {
      const method = m[1].toUpperCase();
      const name = m[2] || m[3];
      if (!name) continue;
      if (!methodHints.has(name)) methodHints.set(name, { method, file: norm });
    }
  }

  return { endpointMap, methodHints };
}

/**
 * Produce API list from Flutter endpoint map.
 */
export function flutterApisFromMap(endpointMap, methodHints) {
  const apis = [];
  for (const [name, info] of endpointMap) {
    const hint = methodHints.get(name);
    apis.push({
      method: hint?.method || "POST", // most UDD APIs are POST via DioClient
      path: info.path,
      file: hint?.file || info.file,
      name,
      note: "Flutter Endpoints",
    });
  }
  return apis;
}
