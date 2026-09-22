/**
 * Global rule prepended to every AI system prompt.
 * Nothing may be invented — only what appears in provided evidence/code.
 */
export const EVIDENCE_ONLY = `EVIDENCE-ONLY MODE (mandatory for every field):
- Report ONLY facts explicitly present in the provided code, digest, schema, or WORKING_EVIDENCE.
- Do NOT invent, assume, or infer: roles (Admin, Manager, Superuser), actors, screens, APIs, endpoints, stored procedures, tables, formulas, foreign keys, or business rules.
- Do NOT guess who performs an action (Admin vs User vs System) unless auth/role/permission labels appear in the evidence.
- If something is not proven in evidence: use empty string, empty array, or omit — never fill with a guess.
- Prefer real names/paths/constants copied from evidence over paraphrased new concepts.
- Summaries must stay faithful to evidence; do not add capabilities the code does not show.`;

export const OVERVIEW_SYSTEM = `${EVIDENCE_ONLY}

You are CodeAtlas, an expert software architect.
You analyze a full project digest (file tree + source/config files) and return STRICT JSON only.
Detect real technologies, modules, APIs, databases, and important calculations/formulas found in the digest.
Be accurate. Prefer concrete paths and endpoint strings over placeholders.
If something is unknown, use empty arrays — do not invent.`;

export function overviewUserPrompt(digest, projectHint) {
  return `Analyze this software project and return JSON with this exact shape:
{
  "projectName": "string",
  "summary": "2-4 sentence project summary based ONLY on digest evidence",
  "technologies": {
    "languages": ["string"],
    "frameworks": ["string"],
    "others": ["string"]
  },
  "modules": {
    "packages": ["dependency package names"],
    "internal": ["actual project modules / features / packages / screens"]
  },
  "apis": [
    { "method": "GET|POST|PUT|PATCH|DELETE|ALL", "path": "/real/path", "file": "relative/file", "name": "optionalName" }
  ],
  "database": [
    { "name": "PostgreSQL|MySQL|MongoDB|...", "orm": "string|null", "evidence": ["file or package evidence"] }
  ],
  "calculations": [
    { "name": "short name", "description": "brief one-liner", "file": "path", "snippet": "code if available" }
  ]
}

Rules:
- internal modules = real feature folders / local packages / screens (not random utils noise)
- For APIs in THIS overview response you may list a sample; disk scan provides the full list
- Do NOT guess ORM — only state Dapper/EF/Prisma if clear evidence in digest
- Do NOT invent API paths, calculation names, or roles
- Do NOT mention Admin/Manager unless those role strings appear in the digest
- projectName hint from upload: ${projectHint || "unknown"}

PROJECT DIGEST:
${digest}`;
}

export const APIS_SYSTEM = `${EVIDENCE_ONLY}

You are CodeAtlas API extractor.
Extract EVERY HTTP API / endpoint from the provided API source files.
Return STRICT JSON only. Never invent endpoints. Never truncate — list all of them.
Resolve Flutter/Dart Endpoints like '\${baseUrl}User/Login' to path "/User/Login".
For ASP.NET MVC use real Controller/Action names only — never use placeholder [controller].`;

export const CALCULATIONS_SYSTEM = `${EVIDENCE_ONLY}

You are CodeAtlas business-logic analyst.
Given calculation candidates extracted from repositories, helpers, controllers, and SQL,
explain EVERY meaningful financial/business calculation found in the code.
Return STRICT JSON only. Never invent calculations not supported by the snippets.
For each item write a clear explanation: what inputs are used, what formula/logic is applied, and what the result means — only from the snippets.`;

export function apisUserPrompt(digest, projectHint) {
  return `Extract ALL APIs from these files for project "${projectHint || "project"}".

Return JSON:
{
  "apis": [
    { "method": "GET|POST|PUT|PATCH|DELETE|ALL", "path": "/Controller/Action", "file": "relative/path", "name": "endpointConstName" }
  ]
}

Rules:
- Include every endpoint constant / route found
- Prefer real path strings (after resolving baseUrl interpolations)
- Default method POST for Dio Flutter APIs unless get/put/delete is clear
- Do NOT stop at 10 — return the complete list
- Do NOT invent paths not in the files

API FILES:
${digest}`;
}

export const MODULE_SYSTEM = `${EVIDENCE_ONLY}

You are CodeAtlas. Explain ONE business feature module in simple language.
Return STRICT JSON only.
The module may contain many screens (list, details, forms, bulk upload). Explain the WHOLE feature together — do not treat list/details as separate modules.
Rules:
- Use very simple language so a new developer understands in under a minute.
- Cover ONLY screens listed in INCLUDES (and evidence in the digest). Never invent screens from other products.
- Do NOT reuse examples about complaints, potholes, citizens, or maps unless THIS module's name/digest is clearly about complaints.
- Read repository SP names and param.Add lines carefully when present — source of truth for .NET/FMS.
- For Flutter/Dart: use screen folders, widgets, blocs/cubits, repositories, endpoint constants — do not invent APIs.
- Do NOT invent scheme-wise vs department-wise behavior. If SaveLimit has FromDepartmentID/ToLevelID and SchemeID is commented out, allocation is DEPARTMENT/LEVEL-wise.
- Do NOT invent roles (Admin vs User). Only mention a role if the digest shows it.
- Keep text SHORT. Prefer one concrete example grounded in THIS module only.
- Never claim allocation is "by scheme" unless SP params clearly pass SchemeID as the allocation key.`;

export function moduleUserPrompt(digest, moduleName, overview, includes = []) {
  const includeList = (includes || []).length
    ? includes.join(", ")
    : "(see digest folders/screens)";
  const sampleScreen = (includes || [])[0] || "Index";
  return `Explain feature module "${moduleName}" for project "${overview?.projectName || "project"}".

INCLUDES (screens/pages inside this module — explain all of these in howItWorks / screensInside):
${includeList}

Return JSON exactly:
{
  "module": "${moduleName}",
  "inBrief": "1-2 short sentences in simple language — what this whole feature does",
  "howItWorks": "4-7 short bullets in one string separated by |  — cover the main user journey across the included screens only",
  "screensInside": [
    { "name": "${sampleScreen}", "does": "one simple sentence what this screen does" }
  ],
  "example": "One everyday example using ONLY this module's screens (e.g. user opens ${sampleScreen} → completes the main action for ${moduleName})",
  "keyRule": "One important rule if any, else empty string",
  "storedProcedures": ["real SP names from digest only — empty array for Flutter"],
  "tablesOrLedger": ["tables/ledger OR flutter data sources if known"],
  "keyFiles": ["max 4 important relative paths"],
  "relatedModules": ["sibling feature modules — not list/details screens"]
}

HARD RULES:
- screensInside: one entry per included screen from INCLUDES only. Names must match INCLUDES (or digest). Simple language.
- NEVER invent "Raise Complaint", "My Complaints", map, or citizen-complaint flows unless "${moduleName}" / INCLUDES clearly contain complaint screens.
- Do NOT say list/details are separate modules — they are parts of "${moduleName}".
- Tripura-FMS: LimitAllocation SaveLimit is DEPARTMENT-WISE; Expenditure tags SchemeID at spend time; LimitHistoryLog is the ledger.
- Flutter: describe screens/flows from folder + dart evidence only. Do not invent endpoints not in digest.
- Do NOT invent Admin/Manager roles or privileged actors.

Digest:
${digest}`;
}

export const DB_SYSTEM = `${EVIDENCE_ONLY}

You are CodeAtlas, a database analyst.
You receive LIVE schema introspection in PAGES (batches of tables).
Return STRICT JSON only.

CRITICAL RULES:
- NEVER invent relationships from table names alone.
- ONLY state declared FK relationships that appear in the provided foreignKeys / relationships arrays.
- Purpose of a table must be based on its columns + PK/FK — not name guessing alone.
- Analyze ONLY the tables in THIS PAGE — do not invent other tables.`;

export const DB_SUMMARY_SYSTEM = `${EVIDENCE_ONLY}

You are CodeAtlas, a database analyst.
You receive a compact rollup of already-analyzed tables + real relationship evidence.
Return STRICT JSON only. Do not invent tables or foreign keys.`;

function compactOverview(overview) {
  return {
    projectName: overview?.projectName,
    database: overview?.database,
    apisCount: overview?.apis?.length || 0,
    moduleCount: overview?.modules?.internal?.length || 0,
    frameworks: overview?.technologies?.frameworks || [],
  };
}

function compactTable(t) {
  return {
    schema: t.schema,
    name: t.name,
    rowCount: t.rowCount,
    primaryKey: t.primaryKey || [],
    foreignKeys: t.foreignKeys || [],
    referencedBy: t.referencedBy || [],
    columns: (t.columns || []).map((c) => ({
      name: c.name,
      type: c.type,
      nullable: c.nullable,
      isPrimaryKey: !!c.isPrimaryKey,
      isForeignKey: !!c.isForeignKey,
    })),
  };
}

export function filterEdgesForTables(edges, tableNames) {
  const set = new Set((tableNames || []).map((n) => String(n).toLowerCase()));
  return (edges || []).filter((e) => {
    const a = String(e.fromTable || e.leftTable || "").toLowerCase();
    const b = String(e.toTable || e.rightTable || "").toLowerCase();
    return set.has(a) || set.has(b);
  });
}

/**
 * One page of tables — keep prompts small for token limits.
 */
export function dbBatchUserPrompt({
  connectionLabel,
  overview,
  pageIndex,
  pageCount,
  tables,
  relationships,
  foreignKeys,
  primaryKeys,
  applicationJoins,
  inferredPkLinks,
}) {
  const names = (tables || []).map((t) => t.name);
  return `Analyze LIVE database PAGE ${pageIndex + 1} of ${pageCount}.
Connection: ${connectionLabel}

Return JSON:
{
  "tables": [
    {
      "name": "table",
      "purpose": "based on columns + PK/FK, not name alone",
      "primaryKey": ["col"],
      "importantColumns": ["col (PK|FK→Parent.col|type): meaning"],
      "relationships": ["ONLY real FKs for this table"],
      "referencedBy": ["ONLY real inbound FKs"]
    }
  ],
  "relationshipMap": [
    {
      "fromTable": "",
      "fromColumn": "",
      "toTable": "",
      "toColumn": "",
      "constraint": "",
      "meaning": "1 sentence"
    }
  ],
  "notes": ["optional short notes for this page"]
}

HARD RULES:
1. relationshipMap only from provided relationships/foreignKeys for this page.
2. Do not invent links from table names.
3. Only analyze these tables: ${names.join(", ")}

Project context:
${JSON.stringify(compactOverview(overview), null, 2)}

PAGE RELATIONSHIPS (${(relationships || []).length}):
${JSON.stringify(relationships || [], null, 2)}

PAGE FOREIGN KEYS (${(foreignKeys || []).length}):
${JSON.stringify(foreignKeys || [], null, 2)}

PAGE PRIMARY KEYS (${(primaryKeys || []).length}):
${JSON.stringify(primaryKeys || [], null, 2)}

PAGE APPLICATION JOINS (${(applicationJoins || []).length}):
${JSON.stringify((applicationJoins || []).slice(0, 40), null, 2)}

PAGE INFERRED PK MATCHES (${(inferredPkLinks || []).length}):
${JSON.stringify((inferredPkLinks || []).slice(0, 40), null, 2)}

PAGE TABLES:
${JSON.stringify((tables || []).map(compactTable), null, 2)}`;
}

export function dbSummaryUserPrompt({
  connectionLabel,
  overview,
  engine,
  tableRollup,
  relationshipMap,
  applicationJoins,
  inferredPkLinks,
}) {
  return `Create a final database overview from already-analyzed pages.
Connection: ${connectionLabel}
Engine: ${engine}

Return JSON:
{
  "engine": "${engine || "Unknown"}",
  "summary": "2-4 sentences based on real tables + relationships",
  "entityGroups": [
    {
      "name": "cluster name",
      "tables": ["only evidence-connected tables"],
      "howConnected": "describe real PK/FK or JOIN evidence"
    }
  ],
  "calculationsOrBusinessLogic": ["how DB relates to app calculations if any"],
  "suggestions": ["missing declared FKs, indexing notes — do not invent relationships"]
}

Project context:
${JSON.stringify(compactOverview(overview), null, 2)}

DECLARED RELATIONSHIPS (${(relationshipMap || []).length}):
${JSON.stringify((relationshipMap || []).slice(0, 120), null, 2)}

APPLICATION JOINS sample (${(applicationJoins || []).length} total):
${JSON.stringify((applicationJoins || []).slice(0, 40), null, 2)}

INFERRED PK MATCHES sample (${(inferredPkLinks || []).length} total):
${JSON.stringify((inferredPkLinks || []).slice(0, 40), null, 2)}

TABLE ROLLUP (${(tableRollup || []).length}):
${JSON.stringify(tableRollup || [], null, 2)}`;
}

/** Compatibility wrapper */
export function dbUserPrompt(args) {
  const tables = args.schema?.tables || [];
  return dbBatchUserPrompt({
    connectionLabel: args.connectionLabel,
    overview: args.overview,
    pageIndex: 0,
    pageCount: 1,
    tables,
    relationships: args.schema?.relationships || [],
    foreignKeys: args.schema?.foreignKeys || [],
    primaryKeys: args.schema?.primaryKeys || [],
    applicationJoins: args.applicationJoins || [],
    inferredPkLinks: args.inferredPkLinks || [],
  });
}

export function calculationsUserPrompt(digest, projectHint, candidateCount) {
  return `Analyze ALL business calculations for project "${projectHint || "project"}".
Found ${candidateCount} code candidates — explain each real calculation (do not skip, do not invent).

Return JSON:
{
  "calculations": [
    {
      "name": "short label e.g. Net Salary / Net Amount",
      "location": "relative/file.cs:line or Class.Method",
      "explanation": "1-2 sentences what this computes",
      "formulaOrLogic": "Result = Term1 + Term2 - Term3  (use + and - so UI can render a breakdown)",
      "inputs": ["BasicSalary", "HRA", "PF"],
      "output": "NetSalary",
      "snippet": "short supporting code excerpt"
    }
  ]
}

Rules:
- formulaOrLogic MUST be equation-style when possible: "Net Amount = Total Amount - Total Deduction"
- inputs = the real field/parameter names that make up the formula (not prose)
- Include totals, deductions, TDS, GST, interest, limits, balances, percentages, stored-proc aggregations
- Merge duplicate logic into one entry with all locations
- If a snippet is only a DB call, explain what the stored procedure/report computes based on parameter/column names
- Minimum ${Math.min(candidateCount, 8)} entries when candidates exist — do not stop at 4

CANDIDATE DIGEST:
${digest}`;
}

export const FLOW_SYSTEM = `${EVIDENCE_ONLY}

You are CodeAtlas. Your job is to explain the OVERALL PROJECT FLOW — how the whole system works end-to-end.

This is NOT the Modules list. Do NOT output one step per module/menu name.
Write a PROCESS journey a new developer can read once and understand the business.

Accuracy rules:
- Only use stored procedures, tables, APIs, and behaviors proven in WORKING_EVIDENCE / digest / API SAMPLE (live code, not comments).
- You may name modules inside a step's detail when those names appear in evidence, but step TITLES must be process stages, not bare module names.
- NEVER invent roles such as Admin. Leave actor empty unless a role label is proven in evidence.
- Authentication: when Login/OTP/password APIs or fields are in evidence, the Authenticate step DETAIL must name the real method (e.g. username+password, mobile+OTP, JWT). Do NOT write vague "via a backend API" if method signals exist. Do NOT invent OTP or password if not proven.
- Happy path and projectFlow must follow the BUSINESS journey from SUMMARY (e.g. funds, beneficiaries, expenditure) — not helper/lookup APIs.
- NEVER make "Retrieve dropdown data", "Get master lists", or Common/Get* endpoints their own flow stage. Mention lookups only inside another step's detail if needed.
- layers.Live procedures and layers.Key tables: ONLY names that appear in WORKING_EVIDENCE storedProcedures/tables. If none, return empty arrays — NEVER invent table names from API path segments (e.g. do not turn /BeneficiaryMaster/GetAll into table BeneficiaryMaster).
- Return STRICT JSON only.`;

export function flowUserPrompt({
  projectName,
  summary,
  technologies,
  workingEvidence,
  apis,
  database,
  mvc,
  digestSnippet,
}) {
  const working = workingEvidence?.workingModules || [];
  const skipped = workingEvidence?.skipped || [];
  return `Create an OVERALL project + data flow for "${projectName || "project"}".

Return JSON:
{
  "headline": "one sentence: what this system does overall (from evidence only) — align with SUMMARY",
  "projectFlow": [
    {
      "step": 1,
      "title": "process stage title (NOT a module name)",
      "actor": "",
      "detail": "what happens + which real API/SP/table if known from evidence",
      "modules": ["optional supporting module names from evidence only"]
    }
  ],
  "dataFlow": [
    {
      "from": "business stage or module from evidence",
      "to": "real table or ledger from evidence",
      "via": "real stored procedure or API name(s) from evidence",
      "detail": "what data moves and why (evidence only)"
    }
  ],
  "layers": [
    { "name": "User journey", "items": ["stage titles"] },
    { "name": "Live procedures", "items": ["SP names from evidence"] },
    { "name": "Key tables", "items": ["table names from evidence"] }
  ],
  "happyPath": "Business stages with arrows — same journey as projectFlow titles (no dropdown/lookup stages)",
  "notes": ["short caveats"]
}

HARD RULES:
1. projectFlow = 5–9 PROCESS stages grounded in evidence. NEVER mirror the Modules list.
2. BAD titles: bare module names only; "Retrieve Dropdown Data"; "Load Common Masters". GOOD titles: Authenticate, Manage beneficiaries, Approve/reject, Allocate funds, Track expenditure (when proven).
3. happyPath MUST mirror the main business stages in projectFlow (aligned with SUMMARY). Do not shorten by dropping funds/expenditure when those appear in SUMMARY/evidence. Do not insert dropdown/lookup as a happy-path stage.
4. Authenticate detail: if API SAMPLE / digest shows OTP, password, username, mobile, JWT, captcha — name those explicitly. Example: "Users sign in with mobile number and OTP via /User/Login (or proven path)." If only a Login endpoint exists with no method signals, say method not clear from scan — do not invent.
5. dataFlow = only REAL SP/table/API names from evidence. Do not invent.
6. Do not invent SPs/tables/APIs. Do not treat commented-out params as active.
7. actor MUST be "" (empty) unless WORKING_EVIDENCE / digest explicitly contains that role label (e.g. "Admin", "Manager"). NEVER invent Admin because a step is configure/delete.
8. Detail text must NOT say "Admin" / "Admins" unless that role appears in evidence. Prefer neutral wording ("The app…", "The user…") without inventing privilege levels.
9. Skipped/unwired menus: notes only.
10. layers "Live procedures" / "Key tables": empty arrays when WORKING_EVIDENCE has no SPs/tables. NEVER invent table names from route segments (BeneficiaryMaster, Expenditure, LimitAllocation as path labels are NOT tables unless listed in evidence.tables).

WORKING_EVIDENCE (source of truth for SPs/tables):
${JSON.stringify(
    working.map((m) => ({
      menu: m.name,
      controller: m.controller,
      sps: m.storedProcedures,
      tables: m.tables,
      summary: m.summary,
    })),
    null,
    2
  )}

SKIPPED_UNWIRED:
${JSON.stringify(skipped.slice(0, 20), null, 2)}

SUMMARY (happy path + stages should match this business goal):
${summary || ""}

TECH:
${JSON.stringify(technologies || {}, null, 2)}

API SAMPLE (use for auth method + real paths; first 40):
${JSON.stringify((apis || []).slice(0, 40), null, 2)}

DATABASE SIGNALS:
${JSON.stringify(database || [], null, 2)}

MVC CONTROLLERS (context — do not list each as a flow step):
${JSON.stringify(
    mvc ? (mvc.controllers || []).slice(0, 25).map((c) => c.name) : [],
    null,
    2
  )}
${digestSnippet ? `\nDIGEST SNIPPET:\n${String(digestSnippet).slice(0, 10000)}\n` : ""}`;
}
