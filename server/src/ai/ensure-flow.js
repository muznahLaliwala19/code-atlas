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

/** Lookup / common-master stages — not main business journey */
function isSupportNoiseStage(step) {
  const title = norm(step?.title);
  const detail = String(step?.detail || "").toLowerCase();
  if (/dropdown|lookup|masterlist|commonmaster|retrievemaster/.test(title)) return true;
  if (/^get(all)?(type|types|list|dropdown)/.test(title)) return true;
  if (
    /retrieve\s+dropdown|dropdown\s+data|load\s+(common\s+)?masters?|common\/get/i.test(
      `${step?.title || ""} ${detail}`
    )
  ) {
    return true;
  }
  return false;
}

function happyPathHasNoise(happyPath) {
  return /dropdown|lookup|common\/get|retrieve\s+dropdown/i.test(String(happyPath || ""));
}

/**
 * Infer auth method from APIs + working evidence — never invent OTP/password.
 */
export function inferAuthMethod(evidence = {}, apis = []) {
  const apiBlob = JSON.stringify(apis || []).toLowerCase();
  const workBlob = JSON.stringify(evidence?.workingModules || []).toLowerCase();
  const blob = `${apiBlob}\n${workBlob}`;

  const loginApis = (apis || []).filter((a) => {
    const p = `${a.path || ""} ${a.name || ""} ${a.action || ""}`.toLowerCase();
    return /login|signin|sign_in|authenticate|auth\/|otp|verifyotp|sendotp/.test(p);
  });
  const loginPaths = loginApis
    .map((a) => a.path || a.name)
    .filter(Boolean)
    .slice(0, 3);

  const hasOtp = /\botp\b|sendotp|verifyotp|mobileotp|phone.?otp|otpverify/.test(blob);
  const hasPassword = /\bpassword\b|passwd|pwd\b/.test(blob);
  const hasUsername = /\busername\b|user_name|userid\b|user_id\b/.test(blob);
  const hasMobile = /\bmobile\b|\bphone\b|mobileno|phone_number|phonenumber/.test(blob);
  const hasCaptcha = /\bcaptcha\b/.test(blob);
  const hasJwt = /\bjwt\b|jsonwebtoken|bearer\s*token|access_token/.test(blob);
  const hasLoginSignal =
    loginApis.length > 0 || /\blogin\b|signin|authenticate/.test(blob);

  if (!hasLoginSignal && !hasOtp && !hasPassword) {
    return { label: null, detail: null, paths: loginPaths };
  }

  const parts = [];
  if (hasOtp && (hasMobile || hasUsername || hasLoginSignal)) {
    if (hasMobile || /sendotp|mobile/.test(blob)) {
      parts.push("mobile number and OTP");
    } else {
      parts.push("OTP verification");
    }
  } else if (hasOtp) {
    parts.push("OTP verification");
  }
  if (hasPassword && (hasUsername || hasLoginSignal)) {
    parts.push(hasUsername ? "username and password" : "password");
  } else if (hasPassword) {
    parts.push("password");
  }
  if (hasCaptcha) parts.push("captcha");
  if (hasJwt) parts.push("JWT/session token");

  let methodLabel = null;
  if (hasOtp && hasPassword) methodLabel = "password and/or OTP";
  else if (hasOtp) methodLabel = hasMobile || /sendotp|mobile/.test(blob) ? "mobile + OTP" : "OTP";
  else if (hasPassword) methodLabel = hasUsername ? "username + password" : "password";
  else if (hasLoginSignal) methodLabel = "login endpoint (method not clear from scan)";

  const pathBit = loginPaths.length ? ` via ${loginPaths.join(", ")}` : "";
  let detail = null;
  if (parts.length) {
    detail = `Users authenticate with ${parts.join(", ")}${pathBit}.`;
  } else if (hasLoginSignal) {
    detail = `Users sign in through a login API${pathBit}; exact credentials (password vs OTP) are not clear from the scan.`;
  }

  return { label: methodLabel, detail, paths: loginPaths };
}

function isVagueAuthDetail(detail) {
  const d = String(detail || "").toLowerCase();
  if (!d) return true;
  if (/otp|password|username|mobile|captcha|jwt/.test(d)) return false;
  return (
    /facilitates user authentication|through a backend api|ensuring secure access|secure access to the system/.test(
      d
    ) || (/authentication/.test(d) && d.length < 120 && !/\/[a-z]/i.test(d))
  );
}

function enrichAuthSteps(projectFlow, evidence, apis) {
  const auth = inferAuthMethod(evidence, apis);
  if (!auth.detail) return projectFlow;

  return projectFlow.map((s) => {
    const title = norm(s.title);
    if (!/auth|login|sign.?in|authenticate/.test(title)) return s;
    if (!isVagueAuthDetail(s.detail)) return s;
    return {
      ...s,
      detail: sanitizeFlowDetail(auth.detail, evidence),
    };
  });
}

function dropSupportNoiseStages(projectFlow) {
  const kept = (projectFlow || []).filter((s) => !isSupportNoiseStage(s));
  // Keep enough stages; if we stripped too much, fall back to original
  if (kept.length >= 3) {
    return kept.map((s, i) => ({ ...s, step: i + 1 }));
  }
  return (projectFlow || []).map((s, i) => ({ ...s, step: i + 1 }));
}

function buildBusinessHappyPath(projectFlow, aiHappyPath, evidence) {
  const fromSteps = (projectFlow || [])
    .filter((s) => !isSupportNoiseStage(s))
    .map((s) => s.title)
    .filter(Boolean);

  const stepNorms = new Set(fromSteps.map((t) => norm(t)));
  const aiPath = String(aiHappyPath || "").trim();
  if (aiPath && !happyPathHasNoise(aiPath)) {
    const aiParts = aiPath
      .split(/\s*→\s*|\s*->\s*/)
      .map((t) => t.trim())
      .filter(Boolean)
      .filter((t) => {
        const n = norm(t);
        return stepNorms.has(n) || [...stepNorms].some((s) => s.includes(n) || n.includes(s));
      });
    if (aiParts.length >= Math.min(3, fromSteps.length) && aiParts.length) {
      return sanitizeFlowDetail(aiParts.join(" → "), evidence);
    }
  }

  return fromSteps.join(" → ");
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
      detail: "Sign-in when a login/OTP/password path is present in the project.",
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

  if (has("approvereject", "approve", "reject") && has("beneficiary")) {
    const m = findMod("beneficiary");
    stages.push({
      step: n++,
      title: "Approve / reject beneficiaries",
      actor: "",
      detail:
        "Beneficiary records can be approved or rejected through the wired approval API when present.",
      modules: m ? [m.name] : [],
    });
  }

  if (has("fund", "allocation", "limitallocation", "savelimit", "limithistory")) {
    const m = findMod("fund", "allocation", "limitallocation", "limit");
    if (!stages.some((s) => /allocate limits/i.test(s.title))) {
      const sps = (m?.storedProcedures || []).filter((s) => /limit|alloc|fund/i.test(s)).slice(0, 3);
      stages.push({
        step: n++,
        title: "Allocate funds / limits",
        actor: "",
        detail:
          sps.length
            ? `Fund or limit allocation runs via ${sps.join(", ")}.`
            : m?.summary ||
              "Funds or department limits are allocated so later spending has a balance to draw from.",
        modules: m ? [m.name] : [],
      });
    }
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
 * Also: name real auth methods when proven; drop dropdown/lookup as journey stages;
 * rebuild happy path as the business journey.
 */
export function ensureCompleteFlow(aiFlow, evidence = {}, { summary = "", apis = [] } = {}) {
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
    projectFlow = processFallback.map((s) => ({
      ...s,
      actor: sanitizeFlowActor(s.actor, evidence),
      detail: sanitizeFlowDetail(s.detail, evidence),
    }));
  }

  projectFlow = dropSupportNoiseStages(projectFlow);
  projectFlow = enrichAuthSteps(projectFlow, evidence, apis);

  // Data flow: prefer compact overall edges; allow AI edges only if they cite real SPs/tables
  const allowed = collectAllowedNames(evidence);
  const evidenceEdges = buildOverallDataFlow(evidence);
  const aiEdges = Array.isArray(ai.dataFlow) ? ai.dataFlow : [];

  const validatedAiEdges = aiEdges.filter((e) => {
    const blob = norm(`${e.from} ${e.to} ${e.via} ${e.detail}`);
    if (!working.length) return false;
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

  // Drop steps the model admits are not in evidence
  projectFlow = projectFlow
    .filter((s) => {
      const blob = `${s.title || ""} ${s.detail || ""}`;
      if (
        /not explicitly listed|not (found )?in (scan )?evidence|inferred only|cannot be determined|\(not in evidence\)/i.test(
          blob
        )
      ) {
        return false;
      }
      return true;
    })
    .map((s, i) => ({ ...s, step: i + 1 }));

  const happyPath = buildBusinessHappyPath(projectFlow, ai.happyPath, evidence);

  const provenSps = [
    ...new Set(working.flatMap((m) => m.storedProcedures || []).filter(Boolean)),
  ].slice(0, 12);
  const provenTables = [
    ...new Set(working.flatMap((m) => m.tables || []).filter(Boolean)),
  ].slice(0, 12);

  // Live procedures + Key tables: evidence only — never keep AI-invented names
  const layers = [
    {
      name: "User journey",
      items: projectFlow.map((s) => s.title).filter(Boolean),
    },
    {
      name: "Live procedures",
      items: provenSps,
    },
    {
      name: "Key tables",
      items: provenTables,
    },
  ];

  const notes = [
    ...(Array.isArray(ai.notes)
      ? ai.notes
          .map((n) => sanitizeFlowDetail(n, evidence))
          .filter((n) => n && !/not explicitly listed/i.test(n))
      : []),
    "Flow is the overall system journey — not a copy of the Modules list.",
    "Live procedures and key tables list only names proven in scan evidence — never assumed from API path labels.",
    !provenSps.length && !provenTables.length
      ? "No stored procedures or database tables were proven in this scan (client/API-only projects often have none until a live DB step)."
      : null,
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
