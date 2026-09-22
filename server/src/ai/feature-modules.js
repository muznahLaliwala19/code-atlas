/**
 * Main business modules for Modules step.
 * Tree shows FEATURE PARENTS only (complaints, disaster_alerts, food_donation).
 * Screen parts (list / details / raise / map / form) stay inside the parent
 * and appear in the click explanation — not as separate tree rows.
 */

const INFRA_CONTROLLERS = new Set([
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

/** Shell folders — not business modules themselves */
const FLUTTER_SHELL = new Set([
  "splash",
  "authentication",
  "auth",
  "login",
  "signup",
  "onboarding",
  "welcome",
  "main",
  "home",
  "dashboard",
  "manage",
  "drawer",
  "bottom_nav",
  "bottomnav",
  "tabs",
  "tab",
  "nav",
  "navigation",
  "wrapper",
  "app",
]);

/** Pure UI leaf names */
const LEAF_NOISE = new Set([
  "add",
  "edit",
  "list",
  "details",
  "detail",
  "view",
  "form",
  "new",
  "index",
  "widgets",
  "components",
  "common",
  "shared",
  "map",
  "overview",
  "page",
  "screen",
  "screens",
  "dialog",
  "bottom_sheet",
  "bottomsheet",
]);

/** Prefer these first when present (FMS-style + common apps) */
const PRIORITY_ORDER = [
  "complaints",
  "complaint",
  "disaster_alerts",
  "disasteralerts",
  "food_donation",
  "fooddonation",
  "emergency_and_safety",
  "budget",
  "budgetsetup",
  "limitallocation",
  "limitrequest",
  "limittransfer",
  "limitreversal",
  "requestlimit",
  "fundreceived",
  "fund_management",
  "fund_allocation",
  "received_funds",
  "beneficiary",
  "expenditure",
  "expenditure_management",
  "payroll",
  "bulkexpenditure",
  "limitsurrender",
  "grant_management",
  "reversal_management",
  "cashbook",
  "payment",
  "deduction",
  "deductionstatus",
  "misreport",
  "reports",
  "calendar",
  "people",
  "camera",
  "administrative",
  "agency",
  "installment",
  "head",
  "department",
  "district",
  "state",
  "city",
  "level",
  "debitaccount",
];

function titleCase(name) {
  return String(name)
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function bareName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

/**
 * Screen / page fragment — belongs inside a feature, not its own module row.
 */
export function isScreenPart(name) {
  const n = bareName(name);
  if (!n) return true;
  if (LEAF_NOISE.has(n)) return true;

  // create_account / otp_verify stay as their own auth modules
  if (n === "create_account" || n === "otp_verify" || n === "signup" || n === "sign_up") {
    return false;
  }

  if (/_(list|details?|form|map|overview|page|screen|view|widgets?|dialog|tile|card|item)$/.test(n)) {
    return true;
  }
  if (/^(list|details?|form|map|overview|raise|my|add|edit|request)_/.test(n)) return true;
  if (/^(raise|my)_/.test(n)) return true;
  if (/community_engagement/.test(n)) return true;
  if (/_request_form$|^request_form$/.test(n)) return true;

  return false;
}

function isScreenTreeRoot(rootLabel = "") {
  return /(?:^|\/)(lib\/screens?|src\/(?:app\/)?screens?|screens?|features|lib\/features)(?:\/|$)/i.test(
    rootLabel
  );
}

/** Collect every nested screen/folder name under a feature (for explanation). */
function collectIncludes(node, out = []) {
  for (const c of node.children || []) {
    const n = bareName(c.name);
    if (!n || FLUTTER_SHELL.has(n)) {
      collectIncludes(c, out);
      continue;
    }
    out.push(titleCase(c.name));
    // Also list screen files if present
    for (const s of c.screens || []) {
      const sn = String(s.name || s.file || "").replace(/\.\w+$/, "");
      if (sn) out.push(titleCase(sn));
    }
    collectIncludes(c, out);
  }
  for (const s of node.screens || []) {
    const sn = String(s.name || s.file || "").replace(/\.\w+$/, "");
    if (sn && bareName(sn) !== bareName(node.name)) out.push(titleCase(sn));
  }
  // unique preserve order
  const seen = new Set();
  return out.filter((x) => {
    const k = bareName(x);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Walk tree: promote shell children; keep only feature parents; collapse screen parts into includes.
 */
function collectFlutterFeatureParents(modules, pathPrefix = "", out = []) {
  for (const m of modules || []) {
    const name = bareName(m.name);
    const path = m.path || (pathPrefix ? `${pathPrefix}/${m.name}` : m.name);
    const kids = m.children || [];

    if (FLUTTER_SHELL.has(name)) {
      collectFlutterFeatureParents(kids, path, out);
      continue;
    }

    // Screen part at this level → skip as parent (may be absorbed later)
    if (isScreenPart(name) && kids.length === 0) continue;

    // If this node is itself a screen-part folder with only more parts, skip
    if (isScreenPart(name)) {
      // Still dive if it has non-part feature kids (rare)
      const featureKids = kids.filter((c) => !isScreenPart(c.name) && !FLUTTER_SHELL.has(bareName(c.name)));
      if (!featureKids.length) continue;
    }

    const includes = collectIncludes(m);
    const hasScreens = (m.screens || []).length > 0 || (m.fileCount || 0) > 0 || includes.length > 0;
    const hasFeatureKids = kids.some(
      (c) => !isScreenPart(c.name) && !FLUTTER_SHELL.has(bareName(c.name))
    );

    // Nested real features under this parent → also flatten as separate parents? 
    // User wants complaints to OWN community_engagement_* — so do NOT promote nested features.
    if (hasScreens || hasFeatureKids || kids.length > 0) {
      out.push({
        id: path,
        name: titleCase(m.name),
        path,
        source: "flutter-screen",
        includes,
        // UI tree: no children — explanation shows includes
        children: [],
      });
    }
  }
  return out;
}

/**
 * Absorb orphan top-level screen parts into a matching parent
 * e.g. raise_complaint → complaints, disaster_alerts_list → disaster_alerts
 */
function absorbOrphanScreenParts(parents) {
  const byBare = new Map(parents.map((p) => [bareName(p.name), p]));
  const keep = [];

  for (const p of parents) {
    const n = bareName(p.name);
    if (!isScreenPart(n)) {
      keep.push(p);
      continue;
    }

    // Find parent whose name is a prefix/stem of this screen part
    let host = null;
    for (const [key, parent] of byBare) {
      if (key === n) continue;
      if (isScreenPart(key)) continue;
      if (n.startsWith(key) || n.includes(key) || key.includes(n.replace(/_(list|details?|form|map|overview)$/, ""))) {
        host = parent;
        break;
      }
    }
    // raise_complaint / my_complaints → complaints
    if (!host) {
      const stem = n
        .replace(/^(raise|my|add|edit|create|request)_/, "")
        .replace(/_(list|details?|form|map|overview|page)$/, "");
      // complaint → complaints
      host =
        byBare.get(stem) ||
        byBare.get(`${stem}s`) ||
        byBare.get(stem.replace(/s$/, "")) ||
        [...byBare.values()].find((p) => {
          const pk = bareName(p.name);
          return stem && (pk.includes(stem) || stem.includes(pk.replace(/s$/, "")));
        });
    }

    if (host) {
      const label = titleCase(p.name);
      host.includes = [...new Set([...(host.includes || []), label, ...(p.includes || [])])];
    } else {
      // No host — keep as its own module only if not a pure leaf name
      if (!LEAF_NOISE.has(n)) keep.push(p);
    }
  }

  return keep;
}

/**
 * Build clickable feature module list from MVC controllers / Flutter screens / deep modules.
 */
export function buildFeatureModules({ mvcStructure, deepModules } = {}) {
  const map = new Map();
  let featureTree = [];

  const add = (id, label, source, extra = {}) => {
    const key = String(id || "").toLowerCase();
    if (!key) return;
    const bare = key.replace(/\s+/g, "").split("/").pop();
    const bareSnake = bareName(bare);
    if (INFRA_CONTROLLERS.has(bareSnake) || INFRA_CONTROLLERS.has(bare)) return;
    if (FLUTTER_SHELL.has(bareSnake) && source !== "mvc-controller") return;
    if (source !== "mvc-controller" && isScreenPart(bareSnake)) return;
    if (map.has(key)) {
      // merge includes
      const prev = map.get(key);
      if (extra.includes?.length) {
        prev.includes = [...new Set([...(prev.includes || []), ...extra.includes])];
      }
      return;
    }
    map.set(key, {
      id: key,
      name: label || titleCase(bare),
      source,
      includes: extra.includes || [],
      ...extra,
    });
  };

  const hasMvc = (mvcStructure?.controllers || []).length > 0;
  if (hasMvc) {
    for (const c of mvcStructure.controllers) {
      add(c.name, titleCase(c.name), "mvc-controller", { includes: [] });
    }
  }

  for (const t of deepModules?.tree || []) {
    if (/controllers\s*\(mvc\)/i.test(t.root || "")) continue;

    if (isScreenTreeRoot(t.root || "") || (!hasMvc && (t.modules || []).length)) {
      let parents = collectFlutterFeatureParents(t.modules || []);
      parents = absorbOrphanScreenParts(parents);

      if (parents.length) {
        for (const b of parents) {
          add(b.id, b.name, "flutter-screen", {
            path: b.path,
            includes: b.includes || [],
          });
        }

        // UI tree: parents only, no nested list/details rows
        featureTree = [
          {
            root: t.root,
            priority: t.priority,
            quality: t.quality,
            modules: parents.map((p) => ({
              name: p.name,
              path: p.path || p.id,
              children: [],
              includes: p.includes || [],
              screens: [],
              screenKinds: [],
            })),
          },
        ];
      }
    }
  }

  // Fallback non-.NET top-level
  if (map.size === 0) {
    for (const t of deepModules?.tree || []) {
      if (/controllers\s*\(mvc\)/i.test(t.root || "")) continue;
      for (const m of t.modules || []) {
        const bare = bareName(m.name);
        if (FLUTTER_SHELL.has(bare)) {
          for (const c of m.children || []) {
            if (isScreenPart(c.name)) continue;
            add(c.path || c.name, titleCase(c.name), "deep-module", {
              includes: collectIncludes(c),
            });
          }
          continue;
        }
        if (isScreenPart(bare)) continue;
        if ((m.children || []).length > 0 || (m.fileCount || 0) > 0) {
          add(m.path || m.name, titleCase(m.name), "deep-module", {
            includes: collectIncludes(m),
          });
        }
      }
    }

    if (!featureTree.length && map.size) {
      featureTree = [
        {
          root: "modules",
          modules: [...map.values()].map((m) => ({
            name: m.name,
            path: m.id || m.name,
            children: [],
            includes: m.includes || [],
            screens: [],
            screenKinds: [],
          })),
        },
      ];
    }
  }

  const list = [...map.values()];
  list.sort((a, b) => {
    const aKey = bareName(String(a.id).split("/").pop());
    const bKey = bareName(String(b.id).split("/").pop());
    const ia = PRIORITY_ORDER.indexOf(aKey);
    const ib = PRIORITY_ORDER.indexOf(bKey);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return a.name.localeCompare(b.name);
  });

  // Sync includes onto featureTree from list
  if (featureTree.length) {
    const byPath = new Map(list.map((m) => [String(m.path || m.id).toLowerCase(), m]));
    const byName = new Map(list.map((m) => [bareName(m.name), m]));
    for (const t of featureTree) {
      t.modules = (t.modules || []).map((mod) => {
        const hit =
          byPath.get(String(mod.path || "").toLowerCase()) || byName.get(bareName(mod.name));
        return {
          ...mod,
          children: [],
          includes: hit?.includes || mod.includes || [],
        };
      });
    }
  }

  return { modules: list, featureTree };
}
