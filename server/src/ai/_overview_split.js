import { walkProject } from "../scanner/walk.js";
import { detectTechnologies } from "../scanner/detect-technologies.js";

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
    { summary: overviewBase.summary }
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
      { summary: overviewBase.summary }
    );
  }

  // Strip internal cache before returning to client
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
