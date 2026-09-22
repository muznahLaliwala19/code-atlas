/**
 * Overall project flow (process journey) — NOT a module list copy.
 * Uses working menu→SP→table evidence to keep accuracy.
 */

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function evidenceText(evidence = {}) {
  return JSON.stringify(evidence || {}).toLowerCase();
}

/** Privileged role labels must appear in evidence — never invent Admin. */
function roleAppearsInEvidence(role, evidence) {
  const blob = evidenceText(evidence);
  const r = String(role || "")
    .toLowerCase()
    .trim();
  if (!r) return false;
  if (/^(user|enduser|member|employee|operator|system|app|application)$/i.test(r)) {
    // Generic labels — only keep if evidence mentions them OR allow empty preference; keep "User" only if present
    return (
      blob.includes(`"${r}"`) ||
      blob.includes(`'${r}'`) ||
      new RegExp(`\\b${r}s?\\b`).test(blob)
    );
  }
  if (/admin|administrator|manager|superuser|superadmin/.test(r)) {
    return (
      /\badmins?\b/.test(blob) ||
      /\badministrators?\b/.test(blob) ||
      blob.includes("isadmin") ||
      blob.includes("roleadmin") ||
      (blob.includes("userrole") && blob.includes("admin")) ||
      /\bmanagers?\b/.test(blob) ||
      blob.includes("superuser") ||
      blob.includes("superadmin")
    );
  }
  return blob.includes(r);
}

export function sanitizeFlowActor(actor, evidence) {
  const raw = String(actor || "").trim();
  if (!raw) return "";
  const parts = raw
    .split(/\s*(?:\/|,|&| and )\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);
  const kept = parts.filter((p) => roleAppearsInEvidence(p, evidence));
  return kept.join(" / ");
}

export function sanitizeFlowDetail(detail, evidence) {
  let d = String(detail || "").trim();
  if (!d) return "";
  if (!roleAppearsInEvidence("Admin", evidence)) {
    d = d
      .replace(/\bAdmins\b/g, "Users")
      .replace(/\bAdmin\b/g, "User")
      .replace(/\badministrators\b/gi, "users")
      .replace(/\badministrator\b/gi, "user");
  }
  return d;
}

function collectAllowedNames(evidence = {}) {
  const working = evidence.workingModules || [];
  const sps = new Set();
  const tables = new Set();
  const modules = new Set();
  for (const m of working) {
    modules.add(norm(m.name));
    modules.add(norm(m.controller));
    for (const sp of m.storedProcedures || []) sps.add(norm(sp));
    for (const t of m.tables || []) tables.add(norm(t));
  }
  return { sps, tables, modules, working };
}

function looksLikeModuleDump(steps, working) {
  if (!steps?.length || !working?.length) return false;
  const businessSteps = steps.filter((s) => !/^(login|dashboard|auth)$/i.test(norm(s.title)));
  if (businessSteps.length < 3) return false;
  let hits = 0;
  for (const s of businessSteps) {
    const t = norm(s.title);
    if (working.some((m) => t === norm(m.name) || t === norm(m.controller) || norm(m.name).includes(t))) {
      hits++;
    }
  }
  // If almost every step is just a module name → it's a dump
  return hits >= Math.max(3, businessSteps.length - 1);
}

/**
 * Build process-oriented stages from working SP/table evidence (fallback when AI dumps modules).
 */
export function buildProcessStagesFromEvidence(evidence = {}) {
  const working = evidence.workingModules || [];
  const allSps = working.flatMap((m) => m.storedProcedures || []);
  const allTables = working.flatMap((m) => m.tables || []);
  const names = working.map((m) => norm(m.controller || m.name));

  const has = (...keys) =>
    keys.some(
      (k) =>
        names.some((n) => n.includes(k)) ||
        allSps.some((sp) => norm(sp).includes(k)) ||
        allTables.some((t) => norm(t).includes(k))
    );

  const findMod = (...keys) =>
    working.find((m) => keys.some((k) => norm(m.controller).includes(k) || norm(m.name).includes(k)));

  const stages = [
    {
      step: 1,
      title: "Authenticate",
      actor: "",
      detail: "Sign-in / session entry when present in the project.",
    },
    {
      step: 2,
      title: "Enter the system",
      actor: "",
      detail: "App surfaces menus or screens that are wired to live code.",
    },
  ];

  let n = 3;

  if (has("budget")) {
    const m = findMod("budget");
    stages.push({
      step: n++,
      title: "Configure budget / heads",
      actor: "",
      detail: m?.summary
        ? `Budget setup runs through ${m.name}: ${m.summary}`
        : "Budget / head structure is configured so later allocations have a financial year context.",
      modules: m ? [m.name] : ["Budget"],
    });
  }

  if (has("limitallocation", "savelimit", "limithistory")) {
    const m = findMod("limitallocation", "limit");
    const sps = (m?.storedProcedures || []).filter((s) => /limit|alloc/i.test(s)).slice(0, 3);
    const tables = (m?.tables || []).filter((t) => /limit|alloc|history/i.test(t)).slice(0, 3);
    stages.push({
      step: n++,
      title: "Allocate limits",
      actor: "",
      detail:
        sps.length || tables.length
          ? `Department/level limits are saved${sps.length ? ` via ${sps.join(", ")}` : ""}${
              tables.length ? ` into ${tables.join(", ")}` : ""
            } — this creates the spendable balance.`
          : "Limits are allocated to departments/levels and written to the limit ledger.",
      modules: m ? [m.name] : [],
    });
  }

  if (has("limitreversal", "reversal")) {
    const m = findMod("limitreversal", "reversal");
    stages.push({
      step: n++,
      title: "Adjust / reverse limits",
      actor: "",
      detail: m?.summary
        ? `Limit adjustments: ${m.summary}`
        : "Previously allocated limits can be reversed or corrected when the reversal path is wired.",
      modules: m ? [m.name] : [],
    });
  }

  if (has("beneficiary")) {
    const m = findMod("beneficiary");
    stages.push({
      step: n++,
      title: "Maintain beneficiaries",
      actor: "",
      detail: m?.summary
        ? `Beneficiary master data: ${m.summary}`
        : "Beneficiaries are maintained so expenditure can be tagged to payees.",
      modules: m ? [m.name] : [],
    });
  }

  if (has("expenditure", "saveexpenditure")) {
    const m = findMod("expenditure");
    const sps = (m?.storedProcedures || []).slice(0, 3);
    stages.push({
      step: n++,
      title: "Record expenditure",
      actor: "",
      detail:
        sps.length
          ? `Spending posts through ${sps.join(", ")}, reducing remaining limit on the ledger (scheme may be tagged at spend time).`
          : "Expenditure is posted against the remaining department/level limit.",
      modules: m ? [m.name] : [],
    });
  }

  if (has("limitsurrender", "surrender")) {
    const m = findMod("limitsurrender", "surrender");
    stages.push({
      step: n++,
      title: "Surrender unused limit",
      actor: "",
      detail: m?.summary
        ? `Unused limit return: ${m.summary}`
        : "Unused allocated limit can be surrendered back up the hierarchy.",
      modules: m ? [m.name] : [],
    });
  }

  if (has("cashbook", "payment", "deduction")) {
    const m = findMod("cashbook", "payment", "deduction");
    stages.push({
      step: n++,
      title: "Payments & books",
      actor: "",
      detail: m?.summary || "Cashbook / payment / deduction paths update books after spend.",
      modules: m ? [m.name] : [],
    });
  }

  if (has("report", "misreport")) {
    const m = findMod("report", "mis");
    stages.push({
      step: n++,
      title: "Review reports",
      actor: "",
      detail: "Reports read allocation vs expenditure vs remaining from the ledger for audit and MIS.",
      modules: m ? [m.name] : ["Reports"],
    });
  }

  // Generic apps (Flutter / non-FMS): group working modules into lifecycle stages
  if (stages.length <= 2 && working.length) {
    const mid = Math.ceil(working.length / 2);
    const primary = working.slice(0, mid);
    const secondary = working.slice(mid);
    stages.push({
      step: n++,
      title: "Core business actions",
      actor: "",
      detail: `Main work happens in: ${primary.map((m) => m.name).join(", ")}.`,
      modules: primary.map((m) => m.name),
    });
    if (secondary.length) {
      stages.push({
        step: n++,
        title: "Supporting actions & output",
        actor: "",
        detail: `Supporting / reporting paths: ${secondary.map((m) => m.name).join(", ")}.`,
        modules: secondary.map((m) => m.name),
      });
    }
  }

  return stages.map((s, i) => ({ ...s, step: i + 1 }));
}

/**
 * Compact data-flow story: stage → SP/table (not Menu→Menu noise).
 */
export function buildOverallDataFlow(evidence = {}) {
  const working = evidence.workingModules || [];
  const edges = [];

  for (const m of working) {
    const sps = m.storedProcedures || [];
    const tables = m.tables || [];
    if (!sps.length && !tables.length) continue;

    if (sps.length && tables.length) {
      edges.push({
        from: m.name,
        to: tables.slice(0, 4).join(", "),
        via: sps.slice(0, 3).join(", "),
        detail: `${m.name} writes/reads ${tables.slice(0, 3).join(", ")} through ${sps.slice(0, 3).join(", ")}`,
        evidence: (m.evidenceFiles || []).slice(0, 2),
      });
    } else if (sps.length) {
      edges.push({
        from: m.name,
        to: sps.slice(0, 4).join(", "),
        via: "StoredProcedure",
        detail: `${m.name} calls live SP(s): ${sps.slice(0, 4).join(", ")}`,
        evidence: (m.evidenceFiles || []).slice(0, 2),
      });
    } else {
      edges.push({
        from: m.name,
        to: tables.slice(0, 4).join(", "),
        via: "CRUD",
        detail: `${m.name} persists to ${tables.slice(0, 4).join(", ")}`,
        evidence: (m.evidenceFiles || []).slice(0, 2),
      });
    }
  }

  // Cross-cutting ledger link when LimitHistoryLog appears
  const ledgerMods = working.filter((m) =>
    (m.tables || []).some((t) => /limithistory/i.test(t)) ||
    (m.storedProcedures || []).some((s) => /limithistory|savelimit|saveexpenditure/i.test(s))
  );
  if (ledgerMods.length >= 2) {
    edges.push({
      from: ledgerMods.map((m) => m.name).join(" + "),
      to: "LimitHistoryLog (shared ledger)",
      via: "allocation & expenditure SPs",
      detail:
        "Allocation increases TotalAllocation; expenditure increases TotalExpenditure; Remain = allocation − expenditure.",
      evidence: ["LimitHistoryLog"],
    });
  }

  return edges.slice(0, 16);
}

/**
 * Prefer AI overall process flow; reject module-list dumps; keep SP/table accuracy.
 */
export function ensureCompleteFlow(aiFlow, evidence = {}, { summary = "" } = {}) {
  const ai = aiFlow && typeof aiFlow === "object" ? aiFlow : {};
  const { working } = collectAllowedNames(evidence);
  const skipped = evidence.skipped || [];

  const processFallback = buildProcessStagesFromEvidence(evidence);
  const aiSteps = Array.isArray(ai.projectFlow) ? ai.projectFlow : [];

  let projectFlow;
  if (aiSteps.length >= 4 && !looksLikeModuleDump(aiSteps, working)) {
    projectFlow = aiSteps.slice(0, 12).map((s, i) => ({
      step: i + 1,
      title: s.title || `Step ${i + 1}`,
      actor: sanitizeFlowActor(s.actor, evidence),
      detail: sanitizeFlowDetail(s.detail, evidence),
      modules: Array.isArray(s.modules) ? s.modules : undefined,
    }));
  } else {
    // AI dumped modules or failed — use process stages
    projectFlow = processFallback.map((s) => ({
      ...s,
      actor: sanitizeFlowActor(s.actor, evidence),
      detail: sanitizeFlowDetail(s.detail, evidence),
    }));
  }

  // Data flow: prefer compact overall edges; allow AI edges only if they cite real SPs/tables
  const allowed = collectAllowedNames(evidence);
  const evidenceEdges = buildOverallDataFlow(evidence);
  const aiEdges = Array.isArray(ai.dataFlow) ? ai.dataFlow : [];

  const validatedAiEdges = aiEdges.filter((e) => {
    const blob = norm(`${e.from} ${e.to} ${e.via} ${e.detail}`);
    if (!working.length) return false;
    // must mention at least one real SP or table or working module
    const hitSp = [...allowed.sps].some((sp) => sp && blob.includes(sp));
    const hitTbl = [...allowed.tables].some((t) => t && blob.includes(t));
    const hitMod = [...allowed.modules].some((m) => m && blob.includes(m));
    return hitSp || hitTbl || hitMod;
  });

  const dataFlow = (validatedAiEdges.length >= 3 ? validatedAiEdges : evidenceEdges).slice(0, 16).map((e) => ({
    from: e.from,
    to: e.to,
    via: e.via,
    detail: e.detail,
    evidence: e.evidence || [],
  }));

  const happyPath =
    ai.happyPath && !looksLikeModuleDump(
      String(ai.happyPath)
        .split(/\s*→\s*|\s*->\s*/)
        .map((t) => ({ title: t })),
      working
    )
      ? sanitizeFlowDetail(ai.happyPath, evidence)
      : projectFlow.map((s) => s.title).join(" → ");

  const layers =
    Array.isArray(ai.layers) && ai.layers.length >= 2
      ? ai.layers.map((layer) => ({
          ...layer,
          items: Array.isArray(layer.items)
            ? layer.items.map((item) => sanitizeFlowDetail(item, evidence))
            : layer.items,
        }))
      : [
          {
            name: "User journey",
            items: projectFlow.map((s) => s.title),
          },
          {
            name: "Live procedures",
            items: [...new Set(working.flatMap((m) => m.storedProcedures || []))].slice(0, 12),
          },
          {
            name: "Key tables",
            items: [...new Set(working.flatMap((m) => m.tables || []))].slice(0, 12),
          },
        ];

  const notes = [
    ...(Array.isArray(ai.notes) ? ai.notes.map((n) => sanitizeFlowDetail(n, evidence)) : []),
    "Flow is the overall system journey — not a copy of the Modules list.",
    skipped.length
      ? `Menus without live SP/CRUD were not used as flow evidence: ${skipped
          .slice(0, 8)
          .map((s) => s.name)
          .join(", ")}`
      : null,
  ].filter(Boolean);

  return {
    headline: sanitizeFlowDetail(
      ai.headline || summary || "Overall project flow: how work moves through the system",
      evidence
    ),
    projectFlow,
    dataFlow,
    layers,
    happyPath,
    notes,
    workingOnly: true,
    evidenceCount: working.length,
  };
}

export function buildMustCoverModules(featureModules = [], mvc = null) {
  const seen = new Set();
  const out = [];
  const push = (id, name, source) => {
    const key = norm(id || name);
    if (!key || seen.has(key)) return;
    if (key === "login" || key === "home" || key === "dashboard" || key === "error") return;
    seen.add(key);
    out.push({ id: key, name: name || id, source });
  };
  for (const m of featureModules || []) push(m.id, m.name, m.source || "feature");
  if (out.length < 4 && mvc?.controllers?.length) {
    for (const c of mvc.controllers) push(c.name, c.name, "mvc");
  }
  return out;
}
