import { aiChat } from "./client.js";
import {
  buildProjectDigest,
  buildApiDigest,
  collectEndpointApisFromDisk,
  collectAspNetApisFromDisk,
} from "./digest.js";
import { collectDeepModulesFromDisk } from "./deep-modules.js";
import { detectArchitectureFromDisk } from "./detect-architecture.js";
import {
  collectAccessAndNavigationFromDisk,
  mergeAccessNavWithDatabase,
} from "./detect-access-nav.js";
import { collectMvcStructureFromDisk, buildMvcModuleTree } from "./mvc-scan.js";
import { buildFeatureModules } from "./feature-modules.js";
import { ensureCompleteFlow } from "./ensure-flow.js";
import { collectWorkingFlowEvidence } from "./working-flow-scan.js";
import { buildFocusedModuleDigest } from "./module-digest.js";
import {
  detectDatabasesFromDisk,
  mergeDatabaseSignals,
} from "./detect-databases-disk.js";
import {
  collectCalculationCandidatesFromDisk,
  buildCalculationsDigest,
} from "./calculations-scan.js";
import {
  OVERVIEW_SYSTEM,
  overviewUserPrompt,
  APIS_SYSTEM,
  apisUserPrompt,
  CALCULATIONS_SYSTEM,
  calculationsUserPrompt,
  MODULE_SYSTEM,
  moduleUserPrompt,
  FLOW_SYSTEM,
  flowUserPrompt,
  DB_SYSTEM,
  DB_SUMMARY_SYSTEM,
  dbBatchUserPrompt,
  dbSummaryUserPrompt,
  filterEdgesForTables,
} from "./prompts.js";
import { introspectDatabase } from "../db/introspect.js";
import { extractRolesPermissionsFromDatabase } from "../db/extract-roles-permissions.js";
import {
  collectApplicationJoinsFromDisk,
  inferColumnPkLinks,
} from "../db/relationship-evidence.js";
import { walkProject } from "../scanner/walk.js";
import { detectTechnologies } from "../scanner/detect-technologies.js";

function mergeApis(...lists) {
  const map = new Map();
  for (const list of lists) {
    for (const a of list || []) {
      if (!a?.path) continue;
      if (/\[controller\]|\[action\]/i.test(a.path)) continue;
      const key = `${(a.method || "GET").toUpperCase()}|${a.path}|${a.name || ""}`;
      if (!map.has(key)) map.set(key, a);
    }
  }
  return [...map.values()].sort((a, b) => String(a.path).localeCompare(String(b.path)));
}

function mergeMvcIntoModules(deepModules, mvcTree) {
  if (!mvcTree?.modules?.length) return deepModules;
  const tree = [...(deepModules.tree || [])];
  const withoutGenericControllers = tree.filter(
    (t) => !/^controllers$/i.test(t.root) && !/^controllers \(mvc\)$/i.test(t.root)
  );
  withoutGenericControllers.unshift({
    root: mvcTree.root,
    priority: mvcTree.priority,
    quality: mvcTree.quality,
    modules: mvcTree.modules,
  });
  const internal = [
    ...new Set([...(mvcTree.flat || []), ...(deepModules.internal || [])]),
  ];
  return {
    ...deepModules,
    tree: withoutGenericControllers,
    internal,
    mvc: true,
  };
}

/**
 * Fast path: disk-only overview (no OpenAI). Shown immediately after unzip.
 */
export async function scanOverviewFromDisk(extractRoot, projectHint) {
  let mvcStructure = null;
  try {
    mvcStructure = await collectMvcStructureFromDisk(extractRoot);
    console.log(
      `[mvc] controllers=${mvcStructure.controllerCount} actions=${mvcStructure.actionCount} views=${mvcStructure.viewLinkedCount}`
    );
  } catch (e) {
    console.warn("[mvc-scan]", e.message);
  }

  let diskApis = [];
  try {
    const dartApis = await collectEndpointApisFromDisk(extractRoot);
    const aspApis = await collectAspNetApisFromDisk(extractRoot);
    const mvcApis = mvcStructure?.apis || [];
    diskApis = mergeApis(dartApis, aspApis, mvcApis);
    console.log(
      `[apis] disk catalog: ${diskApis.length} (dart=${dartApis.length}, mvc=${mvcApis.length})`
    );
  } catch (e) {
    console.warn("[apis-disk]", e.message);
  }

  let deepModules = {
    packages: [],
    internal: [],
    tree: [],
    flat: [],
    leaves: [],
  };
  try {
    deepModules = await collectDeepModulesFromDisk(extractRoot);
    const mvcTree = buildMvcModuleTree(mvcStructure);
    if (mvcTree) deepModules = mergeMvcIntoModules(deepModules, mvcTree);
    console.log(
      `[modules] deep: ${deepModules.internal.length} paths, ${deepModules.leaves.length} leaves`
    );
  } catch (e) {
    console.warn("[modules-disk]", e.message);
  }

  const featurePack = buildFeatureModules({
    mvcStructure,
    deepModules,
  });
  const featureModules = featurePack.modules || featurePack || [];
  const featureTree = featurePack.featureTree || [];
  console.log(`[modules] feature: ${featureModules.length} treeRoots=${featureTree.length}`);

  let diskDatabase = [];
  try {
    diskDatabase = await detectDatabasesFromDisk(extractRoot);
    console.log(`[database] disk signals: ${diskDatabase.length}`);
  } catch (e) {
    console.warn("[database-disk]", e.message);
  }

  let calcCandidates = [];
  try {
    calcCandidates = await collectCalculationCandidatesFromDisk(extractRoot);
    console.log(`[calculations] candidates: ${calcCandidates.length}`);
  } catch (e) {
    console.warn("[calculations-disk]", e.message);
  }

  let technologies = { languages: [], frameworks: [], others: [] };
  try {
    const { files } = await walkProject(extractRoot);
    const tech = detectTechnologies(files);
    technologies = {
      languages: tech.languages || [],
      frameworks: (tech.frameworks || []).filter((f) => f !== "TypeScript"),
      others: tech.others || [],
    };
  } catch (e) {
    console.warn("[tech-disk]", e.message);
  }

  let architecture = null;
  try {
    architecture = await detectArchitectureFromDisk(extractRoot);
    console.log(
      `[architecture] style=${architecture?.style || "n/a"} pattern=${architecture?.pattern || "(none)"}`
    );
  } catch (e) {
    console.warn("[architecture-disk]", e.message);
  }

  let accessNav = null;
  try {
    accessNav = await collectAccessAndNavigationFromDisk(extractRoot, {
      deepModules,
      featureTree,
      mvc: mvcStructure,
      apis: diskApis,
    });
    console.log(
      `[access-nav] roles=${accessNav.roleCount} permissions=${accessNav.permissionCount} screens=${accessNav.navigation?.path?.length || 0}`
    );
  } catch (e) {
    console.warn("[access-nav]", e.message);
  }

  let workingEvidence = {
    menus: [],
    workingModules: [],
    skipped: [],
    dataFlowEdges: [],
  };
  try {
    workingEvidence = await collectWorkingFlowEvidence(extractRoot, {
      mvcStructure: mvcStructure
        ? {
            routePattern: mvcStructure.routePattern,
            controllerCount: mvcStructure.controllerCount,
            actionCount: mvcStructure.actionCount,
            controllers: mvcStructure.controllers,
          }
        : null,
    });
    console.log(
      `[flow-evidence] menus=${workingEvidence.menus.length} working=${workingEvidence.workingModules.length} skipped=${workingEvidence.skipped.length} edges=${workingEvidence.dataFlowEdges.length}`
    );
  } catch (e) {
    console.warn("[flow-evidence]", e.message);
  }

  const projectName = projectHint || "project";
  const overviewBase = {
    projectName,
    summary: "Code scan complete — writing a clearer summary…",
    technologies,
    architecture,
    accessNav,
    modules: {
      packages: deepModules.packages || [],
      internal: deepModules.internal || [],
      feature: featureModules,
      featureTree,
      tree: deepModules.tree || [],
      flat: deepModules.flat || [],
      leaves: deepModules.leaves || [],
    },
    mvc: mvcStructure
      ? {
          routePattern: mvcStructure.routePattern,
          controllerCount: mvcStructure.controllerCount,
          actionCount: mvcStructure.actionCount,
          controllers: mvcStructure.controllers,
        }
      : null,
    apis: diskApis,
    database: diskDatabase,
    calculations: [],
    enriching: true,
    _scanCache: {
      diskApis,
      diskDatabase,
      calcCandidates,
      deepModulesPackages: deepModules.packages || [],
    },
  };

  const flow = ensureCompleteFlow(
    {
      headline: "Process flow is being prepared…",
      notes: ["Disk evidence is ready — AI narrative loads next."],
    },
    workingEvidence,
    { summary: overviewBase.summary, apis: diskApis }
  );

  return {
    ...overviewBase,
    flow,
    workingEvidence: {
      menus: workingEvidence?.menus || [],
      workingModules: workingEvidence?.workingModules || [],
      skipped: workingEvidence?.skipped || [],
      dataFlowEdges: workingEvidence?.dataFlowEdges || [],
    },
    meta: {
      engine: "disk",
      enriching: true,
      apiCount: diskApis.length,
      apiSource: "disk+mvc",
      moduleSource: deepModules.internal.length ? "deep-disk" : "none",
      databaseSource: diskDatabase.length ? "disk" : "none",
      calculationCandidates: calcCandidates.length,
      mvcControllers: mvcStructure?.controllerCount || 0,
      hasFlow: !!(flow?.projectFlow || []).length,
      workingFlowModules: workingEvidence?.workingModules?.length || 0,
      skippedUnwiredMenus: workingEvidence?.skipped?.length || 0,
    },
  };
}

/**
 * Slow path: OpenAI enrichment on top of a disk scan overview.
 */
export async function enrichOverviewWithAi(extractRoot, projectHint, diskOverview) {
  const cache = diskOverview?._scanCache || {};
  const diskApis = cache.diskApis || diskOverview?.apis || [];
  const diskDatabase = cache.diskDatabase || diskOverview?.database || [];
  const calcCandidates = cache.calcCandidates || [];

  const { digest, stats } = await buildProjectDigest(extractRoot);

  const result = await aiChat({
    system: OVERVIEW_SYSTEM,
    user: overviewUserPrompt(digest, projectHint),
    json: true,
  });

  let aiOverviewApis = Array.isArray(result.apis) ? result.apis : [];
  let aiPassApis = [];

  try {
    const apiPack = await buildApiDigest(extractRoot);
    if (apiPack.stats.includedFiles > 0 && diskApis.length < 20) {
      const apiResult = await aiChat({
        system: APIS_SYSTEM,
        user: apisUserPrompt(apiPack.digest, projectHint),
        json: true,
        maxTokens: 16000,
      });
      aiPassApis = Array.isArray(apiResult.apis) ? apiResult.apis : [];
      console.log(`[apis] ai pass: ${aiPassApis.length}`);
    }
  } catch (e) {
    console.warn("[apis-ai]", e.message);
  }

  const apis =
    diskApis.length >= 10
      ? mergeApis(diskApis, aiPassApis)
      : mergeApis(diskApis, aiPassApis, aiOverviewApis);

  const aiPackages = result.modules?.packages || [];
  const packages =
    aiPackages.length > 0
      ? aiPackages
      : cache.deepModulesPackages || diskOverview?.modules?.packages || [];

  const internal =
    (diskOverview?.modules?.internal || []).length > 0
      ? diskOverview.modules.internal
      : result.modules?.internal || [];

  const database = mergeDatabaseSignals(
    diskDatabase,
    Array.isArray(result.database) ? result.database : []
  );

  let calculations = Array.isArray(result.calculations) ? result.calculations : [];
  if (calcCandidates.length > 0) {
    try {
      const { digest: calcDigest } = await buildCalculationsDigest(calcCandidates);
      const calcResult = await aiChat({
        system: CALCULATIONS_SYSTEM,
        user: calculationsUserPrompt(calcDigest, projectHint, calcCandidates.length),
        json: true,
        maxTokens: 16000,
      });
      const explained = Array.isArray(calcResult.calculations) ? calcResult.calculations : [];
      if (explained.length >= calculations.length) {
        calculations = explained;
      } else {
        calculations = [...explained, ...calculations].slice(0, Math.max(explained.length, 30));
      }
      console.log(`[calculations] explained: ${calculations.length}`);
    } catch (e) {
      console.warn("[calculations-ai]", e.message);
    }
  }

  const techFromAi = result.technologies || {};
  const technologies = {
    languages:
      (techFromAi.languages || []).length > 0
        ? techFromAi.languages
        : diskOverview?.technologies?.languages || [],
    frameworks:
      (techFromAi.frameworks || []).length > 0
        ? techFromAi.frameworks
        : diskOverview?.technologies?.frameworks || [],
    others:
      (techFromAi.others || []).length > 0
        ? techFromAi.others
        : diskOverview?.technologies?.others || [],
  };

  const overviewBase = {
    projectName: result.projectName || diskOverview?.projectName || projectHint || "project",
    summary: result.summary || diskOverview?.summary || "",
    technologies,
    architecture: diskOverview?.architecture || null,
    accessNav: diskOverview?.accessNav || null,
    modules: {
      packages,
      internal,
      feature: diskOverview?.modules?.feature || [],
      featureTree: diskOverview?.modules?.featureTree || [],
      tree: diskOverview?.modules?.tree || [],
      flat: diskOverview?.modules?.flat || [],
      leaves: diskOverview?.modules?.leaves || [],
    },
    mvc: diskOverview?.mvc || null,
    apis,
    database,
    calculations,
    enriching: false,
  };

  const workingEvidence = diskOverview?.workingEvidence || {
    menus: [],
    workingModules: [],
    skipped: [],
    dataFlowEdges: [],
  };

  let flow = null;
  try {
    const digestSnippet = [
      `PROJECT: ${overviewBase.projectName}`,
      `GOAL: overall PROCESS journey (not a module list)`,
      `WORKING_SP_TABLE_EVIDENCE: ${JSON.stringify(
        (workingEvidence.workingModules || []).map((m) => ({
          menu: m.name,
          sps: m.storedProcedures,
          tables: m.tables,
        })),
        null,
        2
      ).slice(0, 10000)}`,
      `SKIPPED_UNWIRED: ${(workingEvidence.skipped || []).map((s) => s.name).join(", ") || "(none)"}`,
    ].join("\n");

    const rawFlow = await aiChat({
      system: FLOW_SYSTEM,
      user: flowUserPrompt({
        projectName: overviewBase.projectName,
        summary: overviewBase.summary,
        technologies: overviewBase.technologies,
        workingEvidence,
        apis,
        database,
        mvc: overviewBase.mvc,
        digestSnippet,
      }),
      json: true,
      maxTokens: 8000,
    });

    flow = ensureCompleteFlow(rawFlow, workingEvidence, {
      summary: overviewBase.summary,
      apis,
    });
    console.log(
      `[flow] working=${(workingEvidence.workingModules || []).length} steps=${(flow.projectFlow || []).length} dataEdges=${(flow.dataFlow || []).length}`
    );
  } catch (e) {
    console.warn("[flow-ai]", e.message);
    flow = ensureCompleteFlow(
      {
        headline: overviewBase.summary || overviewBase.projectName,
        notes: ["Flow AI failed — showing disk evidence only (menus → SP/CRUD → tables)."],
      },
      workingEvidence,
      { summary: overviewBase.summary, apis }
    );
  }

  return {
    ...overviewBase,
    flow,
    workingEvidence: {
      menus: workingEvidence?.menus || [],
      workingModules: workingEvidence?.workingModules || [],
      skipped: workingEvidence?.skipped || [],
      dataFlowEdges: workingEvidence?.dataFlowEdges || [],
    },
    meta: {
      engine: "ai",
      enriching: false,
      digestStats: stats,
      apiCount: apis.length,
      apiSource: diskApis.length >= 10 ? "disk+mvc" : "disk+ai",
      moduleSource: (diskOverview?.modules?.internal || []).length ? "deep-disk" : "ai",
      databaseSource: diskDatabase.length ? "disk+ai" : "ai",
      calculationCandidates: calcCandidates.length,
      mvcControllers: overviewBase.mvc?.controllerCount || 0,
      hasFlow: !!(flow?.projectFlow || []).length,
      workingFlowModules: workingEvidence?.workingModules?.length || 0,
      skippedUnwiredMenus: workingEvidence?.skipped?.length || 0,
    },
  };
}

/** Full analyze (scan + enrich) — kept for compatibility */
export async function aiAnalyzeOverview(extractRoot, projectHint) {
  const disk = await scanOverviewFromDisk(extractRoot, projectHint);
  return enrichOverviewWithAi(extractRoot, projectHint, disk);
}

export async function aiExplainModule(extractRoot, moduleName, overview) {
  const includes = findModuleIncludes(overview, moduleName);
  const { digest, stats } = await buildFocusedModuleDigest(extractRoot, moduleName);
  console.log(
    `[module-explain] ${moduleName} files=${stats.files} includes=${includes.length} sps=${(stats.storedProcedures || []).join(",")}`
  );

  const result = await aiChat({
    system: MODULE_SYSTEM,
    user: moduleUserPrompt(digest, moduleName, overview, includes),
    json: true,
    maxTokens: 5000,
  });

  let screensInside = Array.isArray(result.screensInside) ? result.screensInside : [];
  // Fallback: build simple screen list from includes if AI omitted
  if (!screensInside.length && includes.length) {
    screensInside = includes.map((name) => ({
      name,
      does: `Part of ${moduleName}`,
    }));
  }

  const moduleIsComplaint = /complaint/i.test(moduleName);
  const includeNorm = new Set(
    (includes || []).map((x) => String(x).toLowerCase().replace(/[^a-z0-9]/g, ""))
  );
  const looksLikeComplaintExample = (text) =>
    /raise\s*complaint|my\s*complaints|pothole|citizen raises/i.test(String(text || ""));

  // Drop prompt-example contamination ("Raise Complaint") on unrelated modules
  if (!moduleIsComplaint) {
    screensInside = screensInside.filter((s) => {
      const name = s?.name || s;
      if (looksLikeComplaintExample(name) || looksLikeComplaintExample(s?.does)) return false;
      if (!includeNorm.size) return true;
      const n = String(name).toLowerCase().replace(/[^a-z0-9]/g, "");
      return (
        includeNorm.has(n) ||
        [...includeNorm].some((inc) => inc.includes(n) || n.includes(inc))
      );
    });
  }

  let howParts = String(result.howItWorks || "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!moduleIsComplaint) {
    howParts = howParts.filter((line) => !looksLikeComplaintExample(line));
  }

  let example = result.example || "";
  if (!moduleIsComplaint && looksLikeComplaintExample(example)) {
    example = "";
  }

  if (!screensInside.length && includes.length) {
    screensInside = includes.map((name) => ({
      name,
      does: `Part of ${moduleName}`,
    }));
  }

  return {
    module: result.module || moduleName,
    inBrief: result.inBrief || result.purpose || "",
    purpose: result.inBrief || result.purpose || "",
    howItWorks: howParts,
    responsibilities: howParts.length ? howParts : result.responsibilities || [],
    screensInside,
    includes,
    example,
    keyRule: result.keyRule || "",
    storedProcedures: Array.isArray(result.storedProcedures)
      ? result.storedProcedures
      : stats.storedProcedures || [],
    tablesOrLedger: Array.isArray(result.tablesOrLedger) ? result.tablesOrLedger : [],
    keyFiles: Array.isArray(result.keyFiles) ? result.keyFiles.slice(0, 4) : [],
    relatedModules: Array.isArray(result.relatedModules) ? result.relatedModules : [],
    meta: { digestStats: stats, style: "feature-parent-simple" },
  };
}

function findModuleIncludes(overview, moduleName) {
  const needle = String(moduleName || "")
    .toLowerCase()
    .replace(/\\/g, "/");
  const bare = needle.split("/").pop().replace(/\s+/g, "_");
  const features = overview?.modules?.feature || [];
  for (const m of features) {
    const id = String(m.id || m.path || "").toLowerCase();
    const name = String(m.name || "")
      .toLowerCase()
      .replace(/\s+/g, "_");
    if (id === needle || id.endsWith(needle) || name === bare || id.includes(bare)) {
      return Array.isArray(m.includes) ? m.includes : [];
    }
  }
  // featureTree fallback
  for (const t of overview?.modules?.featureTree || []) {
    for (const m of t.modules || []) {
      const path = String(m.path || "").toLowerCase();
      const name = String(m.name || "")
        .toLowerCase()
        .replace(/\s+/g, "_");
      if (path === needle || path.endsWith(needle) || name === bare) {
        return Array.isArray(m.includes) ? m.includes : [];
      }
    }
  }
  return [];
}

const DB_TABLES_PER_PAGE = 12;

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function enrichAiTables(aiTables, schema) {
  const tables = (Array.isArray(aiTables) ? aiTables : []).map((t) => {
    const live = (schema.tables || []).find(
      (x) => String(x.name).toLowerCase() === String(t.name).toLowerCase()
    );
    return {
      ...t,
      primaryKey: live?.primaryKey || t.primaryKey || [],
      foreignKeys: live?.foreignKeys || [],
      referencedBy: live?.referencedBy || [],
      relationships: (live?.foreignKeys || []).map(
        (fk) =>
          `${live.name}.${fk.column} → ${fk.referencesTable}.${fk.referencesColumn} (${fk.constraint})`
      ),
      inboundRelationships: (live?.referencedBy || []).map(
        (fk) => `${fk.fromTable}.${fk.fromColumn} → ${live.name} (via ${fk.constraint})`
      ),
      columns: live?.columns || [],
      rowCount: live?.rowCount ?? null,
    };
  });

  const aiNames = new Set(tables.map((t) => String(t.name).toLowerCase()));
  for (const live of schema.tables || []) {
    if (aiNames.has(String(live.name).toLowerCase())) continue;
    tables.push({
      name: live.name,
      purpose: "Present in live schema (AI omitted — shown from introspection).",
      primaryKey: live.primaryKey || [],
      importantColumns: (live.columns || [])
        .filter((c) => c.isPrimaryKey || c.isForeignKey)
        .map((c) => {
          if (c.isPrimaryKey) return `${c.name} (PK, ${c.type})`;
          const fk = (live.foreignKeys || []).find((f) => f.column === c.name);
          return fk
            ? `${c.name} (FK→${fk.referencesTable}.${fk.referencesColumn}, ${c.type})`
            : `${c.name} (${c.type})`;
        }),
      relationships: (live.foreignKeys || []).map(
        (fk) =>
          `${live.name}.${fk.column} → ${fk.referencesTable}.${fk.referencesColumn} (${fk.constraint})`
      ),
      inboundRelationships: (live.referencedBy || []).map(
        (fk) => `${fk.fromTable}.${fk.fromColumn} → ${live.name} (via ${fk.constraint})`
      ),
      foreignKeys: live.foreignKeys || [],
      referencedBy: live.referencedBy || [],
      columns: live.columns || [],
      rowCount: live.rowCount ?? null,
    });
  }
  return tables;
}

function filterDeclaredRelationships(aiMap, schema) {
  const liveEdges = new Set(
    (schema.relationships || []).map(
      (r) =>
        `${String(r.fromTable).toLowerCase()}.${String(r.fromColumn).toLowerCase()}→${String(r.toTable).toLowerCase()}.${String(r.toColumn).toLowerCase()}`
    )
  );

  const relationshipMap = (Array.isArray(aiMap) ? aiMap : [])
    .filter((r) => {
      if (!r?.fromTable || !r?.toTable || !r?.fromColumn || !r?.toColumn) return false;
      const key = `${String(r.fromTable).toLowerCase()}.${String(r.fromColumn).toLowerCase()}→${String(r.toTable).toLowerCase()}.${String(r.toColumn).toLowerCase()}`;
      return liveEdges.has(key);
    })
    .map((r) => {
      const live = (schema.relationships || []).find(
        (x) =>
          x.fromTable.toLowerCase() === String(r.fromTable).toLowerCase() &&
          x.fromColumn.toLowerCase() === String(r.fromColumn).toLowerCase() &&
          x.toTable.toLowerCase() === String(r.toTable).toLowerCase() &&
          x.toColumn.toLowerCase() === String(r.toColumn).toLowerCase()
      );
      return {
        fromTable: live?.fromTable || r.fromTable,
        fromColumn: live?.fromColumn || r.fromColumn,
        toTable: live?.toTable || r.toTable,
        toColumn: live?.toColumn || r.toColumn,
        constraint: live?.constraint || r.constraint || null,
        meaning: r.meaning || null,
        edge: live?.edge || `${r.fromTable}.${r.fromColumn} → ${r.toTable}.${r.toColumn}`,
        source: "declared-fk",
      };
    });

  if (relationshipMap.length > 0) return relationshipMap;

  return (schema.relationships || []).map((r) => ({
    fromTable: r.fromTable,
    fromColumn: r.fromColumn,
    toTable: r.toTable,
    toColumn: r.toColumn,
    constraint: r.constraint,
    meaning: null,
    edge: r.edge,
    source: "declared-fk",
  }));
}

export async function aiAnalyzeDatabase(connectionString, overview, extractRoot = null) {
  const schema = await introspectDatabase(connectionString);

  let applicationJoins = [];
  if (extractRoot) {
    try {
      applicationJoins = await collectApplicationJoinsFromDisk(extractRoot);
      console.log(`[database] application JOINs from code: ${applicationJoins.length}`);
    } catch (e) {
      console.warn("[database-joins]", e.message);
    }
  }

  const inferredPkLinks = inferColumnPkLinks(schema);
  const allTables = schema.tables || [];
  const pages = chunkArray(allTables, DB_TABLES_PER_PAGE);
  console.log(
    `[database] live FKs=${(schema.foreignKeys || []).length} inferredPkLinks=${inferredPkLinks.length} tables=${allTables.length} pages=${pages.length} (size=${DB_TABLES_PER_PAGE})`
  );

  const mergedAiTables = [];
  const mergedAiRelationships = [];
  const pageNotes = [];

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const pageTables = pages[pageIndex];
    const names = pageTables.map((t) => t.name);
    console.log(
      `[database] AI page ${pageIndex + 1}/${pages.length}: ${names.slice(0, 5).join(", ")}${names.length > 5 ? "…" : ""}`
    );

    try {
      const pageResult = await aiChat({
        system: DB_SYSTEM,
        user: dbBatchUserPrompt({
          connectionLabel: schema.engine,
          overview,
          pageIndex,
          pageCount: pages.length,
          tables: pageTables,
          relationships: filterEdgesForTables(schema.relationships, names),
          foreignKeys: filterEdgesForTables(schema.foreignKeys, names),
          primaryKeys: (schema.primaryKeys || []).filter((pk) =>
            names.some((n) => n.toLowerCase() === String(pk.table).toLowerCase())
          ),
          applicationJoins: filterEdgesForTables(applicationJoins, names),
          inferredPkLinks: filterEdgesForTables(inferredPkLinks, names),
        }),
        json: true,
        maxTokens: 8000,
      });

      if (Array.isArray(pageResult.tables)) mergedAiTables.push(...pageResult.tables);
      if (Array.isArray(pageResult.relationshipMap)) {
        mergedAiRelationships.push(...pageResult.relationshipMap);
      }
      if (Array.isArray(pageResult.notes)) pageNotes.push(...pageResult.notes);
    } catch (e) {
      console.warn(`[database] page ${pageIndex + 1} failed:`, e.message);
      for (const live of pageTables) {
        mergedAiTables.push({
          name: live.name,
          purpose: "Live schema table (AI page failed — showing introspection only).",
          primaryKey: live.primaryKey || [],
          importantColumns: (live.columns || [])
            .filter((c) => c.isPrimaryKey || c.isForeignKey)
            .map((c) => `${c.name} (${c.type})`),
        });
      }
    }
  }

  const finalRelationships = filterDeclaredRelationships(mergedAiRelationships, schema);
  const tables = enrichAiTables(mergedAiTables, schema);

  const tableRollup = tables.map((t) => ({
    name: t.name,
    purpose: (t.purpose || "").slice(0, 220),
    primaryKey: t.primaryKey || [],
    fkOut: (t.relationships || []).slice(0, 8),
    fkIn: (t.inboundRelationships || []).slice(0, 8),
    rowCount: t.rowCount,
  }));

  let summaryResult = {
    engine: schema.engine,
    summary: `${schema.engine} schema with ${tables.length} tables analyzed in ${pages.length} page(s).`,
    entityGroups: [],
    calculationsOrBusinessLogic: [],
    suggestions: pageNotes.slice(0, 20),
  };

  try {
    summaryResult = await aiChat({
      system: DB_SUMMARY_SYSTEM,
      user: dbSummaryUserPrompt({
        connectionLabel: schema.engine,
        overview,
        engine: schema.engine,
        tableRollup,
        relationshipMap: finalRelationships,
        applicationJoins,
        inferredPkLinks,
      }),
      json: true,
      maxTokens: 6000,
    });
  } catch (e) {
    console.warn("[database] summary page failed:", e.message);
  }

  let rolesPermissions = {
    roles: [],
    permissions: [],
    evidence: [],
    notes: ["Role/permission extraction did not run."],
    source: "database",
  };
  try {
    rolesPermissions = await extractRolesPermissionsFromDatabase(connectionString, schema);
    console.log(
      `[database] roles=${rolesPermissions.roles?.length || 0} permissions=${rolesPermissions.permissions?.length || 0}`
    );
  } catch (e) {
    console.warn("[database] roles/permissions extract:", e.message);
    rolesPermissions = {
      roles: [],
      permissions: [],
      evidence: [],
      notes: [`Could not read role/permission rows: ${e.message}`],
      source: "database",
    };
  }

  return {
    ...summaryResult,
    engine: summaryResult.engine || schema.engine,
    relationshipMap: finalRelationships,
    applicationJoins,
    inferredPkLinks,
    tables,
    entityGroups: Array.isArray(summaryResult.entityGroups) ? summaryResult.entityGroups : [],
    rolesPermissions,
    schemaPreview: {
      tableCount: schema.tables?.length || 0,
      foreignKeyCount: schema.foreignKeys?.length || 0,
      primaryKeyCount: schema.primaryKeys?.length || 0,
      relationshipCount: schema.relationships?.length || 0,
      applicationJoinCount: applicationJoins.length,
      inferredPkLinkCount: inferredPkLinks.length,
      pageCount: pages.length,
      pageSize: DB_TABLES_PER_PAGE,
      tables: (schema.tables || []).map((t) => ({
        name: t.name,
        schema: t.schema,
        rowCount: t.rowCount,
        columnCount: t.columns?.length || 0,
        primaryKey: t.primaryKey || [],
        foreignKeyCount: (t.foreignKeys || []).length,
      })),
    },
    meta: {
      source: "live-introspection+ai-paged",
      pages: pages.length,
      pageSize: DB_TABLES_PER_PAGE,
    },
  };
}

