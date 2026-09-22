"use client";

import { useCallback, useEffect, useMemo, useRef, useState, Fragment } from "react";
import styles from "./page.module.css";

const apiBase = () =>
  (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");

const DB_TABLES_PER_PAGE = 8;
const ACTIONS_PER_PAGE = 10;
const CALCS_PER_PAGE = 5;

function Chip({ children, tone = "default", onClick, active }) {
  return (
    <button
      type="button"
      className={`${styles.chip} ${styles[`chip_${tone}`] || ""} ${active ? styles.chipActive : ""} ${onClick ? styles.chipClickable : ""}`}
      onClick={onClick}
      disabled={!onClick}
    >
      {children}
    </button>
  );
}

function Section({ title, subtitle, children }) {
  return (
    <section className={`${styles.section} rise`}>
      <header className={styles.sectionHead}>
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </header>
      {children}
    </section>
  );
}

function ModuleTreeNode({ node, depth = 0, onSelect, selected, clickable, keyPrefix = "n" }) {
  return (
    <div className={styles.modNode} style={{ paddingLeft: depth * 14 }}>
      <div className={styles.modRow}>
        {clickable ? (
          <button
            type="button"
            className={`${styles.modNameBtn} ${selected === node.path ? styles.modNameActive : ""}`}
            onClick={() => onSelect?.(node.path || node.name)}
          >
            {node.name}
          </button>
        ) : (
          <span className={styles.modName}>{node.name}</span>
        )}
      </div>
      {(node.children || []).map((c, i) => {
        const childKey = `${keyPrefix}/${c.path || c.name || "node"}#${i}`;
        return (
          <ModuleTreeNode
            key={childKey}
            keyPrefix={childKey}
            node={c}
            depth={depth + 1}
            onSelect={onSelect}
            selected={selected}
            clickable={clickable}
          />
        );
      })}
    </div>
  );
}

function ModuleTree({ tree, onSelect, selected, clickable }) {
  const roots = [];
  for (const t of tree || []) {
    for (const m of t.modules || []) roots.push(m);
  }
  if (!roots.length) return <p className={styles.empty}>No nested modules found</p>;
  return (
    <div className={styles.modTree}>
      {roots.map((m, i) => {
        const rootKey = `${m.path || m.name || "root"}#${i}`;
        return (
          <ModuleTreeNode
            key={rootKey}
            keyPrefix={rootKey}
            node={m}
            depth={0}
            onSelect={onSelect}
            selected={selected}
            clickable={clickable}
          />
        );
      })}
    </div>
  );
}

/** Same tree UI for every stack — Flutter / RN / Next / .NET */
function modulesStepTree(overview) {
  if ((overview?.modules?.featureTree || []).length > 0) {
    return overview.modules.featureTree;
  }
  // Prefer business feature list as a clean flat tree (.NET controllers, etc.)
  if ((overview?.modules?.feature || []).length > 0) {
    return [
      {
        root: "modules",
        modules: overview.modules.feature.map((m) => ({
          name: m.name,
          path: m.id || m.name,
          children: [],
          screens: [],
          screenKinds: [],
        })),
      },
    ];
  }
  // Fallback: overview deep tree (already nested)
  if ((overview?.modules?.tree || []).length > 0) {
    return overview.modules.tree;
  }
  const internal = (overview?.modules?.internal || []).filter((m) => !String(m).includes("/"));
  if (!internal.length) return [];
  return [
    {
      root: "modules",
      modules: internal.map((m) => ({
        name: m,
        path: m,
        children: [],
        screens: [],
        screenKinds: [],
      })),
    },
  ];
}

function inferEndpointPurpose(row) {
  const action = String(row.action || row.name || "").trim();
  const type = String(row.type || "").toLowerCase();
  const method = String(row.method || "GET").toUpperCase();
  const lower = action.toLowerCase();

  if (/^getall|^list|^index$|^fetch|^load|^find|^search|^query|^read/.test(lower)) {
    return "Fetch / list data";
  }
  if (/^get|^show|^view|^detail|^details/.test(lower)) {
    return "Fetch one record / details";
  }
  if (/^add|^create|^insert|^save|^register|^post/.test(lower)) {
    return "Create record";
  }
  if (/^update|^edit|^modify|^put|^patch/.test(lower)) {
    return "Update record";
  }
  if (/^delete|^remove|^destroy/.test(lower)) {
    return "Delete record";
  }
  if (/download|export|file/.test(lower)) return "Download / export file";
  if (/login|auth|signin/.test(lower)) return "Authentication";
  if (/logout|signout/.test(lower)) return "Sign out";

  if (type === "page" || type === "partial") return "Serves UI page / form";
  if (type === "api") return "API / JSON response";
  if (type === "redirect") return "Redirect";
  if (type === "file") return "File response";

  if (method === "GET") return "Read request";
  if (method === "POST") return "Write / submit request";
  if (method === "PUT" || method === "PATCH") return "Update request";
  if (method === "DELETE") return "Delete request";
  return "Endpoint handler";
}

function handlerFromFile(file) {
  const f = String(file || "").replace(/\\/g, "/");
  const base = f.split("/").pop() || "";
  if (/Controller\.cs$/i.test(base)) return base.replace(/Controller\.cs$/i, "");
  if (/route\.(js|ts|tsx)$/i.test(base)) {
    const parts = f.split("/");
    const apiIdx = parts.findIndex((p) => p === "api" || p === "routes");
    if (apiIdx >= 0) return parts.slice(apiIdx, -1).join("/") || base;
  }
  return base.replace(/\.(js|ts|tsx|py|dart|cs)$/i, "") || "—";
}

/**
 * One table for every stack: Endpoint · Handler · Action · Purpose · Detail
 * Prefers MVC actions (real routes) over weak API rows with path "/".
 */
function buildUnifiedEndpoints(overview) {
  const rows = [];
  const seen = new Set();

  const push = (row) => {
    const method = String(row.method || "GET").toUpperCase();
    const path = row.path || "/";
    const handler = row.handler || "—";
    const action = row.action || row.name || "—";
    const key = `${method}|${path}|${handler}|${action}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({
      method,
      path,
      handler,
      action,
      purpose: row.purpose || inferEndpointPurpose({ ...row, method, action }),
      type: row.type || "",
      view: row.view || "",
      returnKind: row.returnKind || "",
      params: row.params || "",
      file: row.file || "",
      stack: row.stack || "generic",
    });
  };

  const controllers = overview?.mvc?.controllers || [];
  for (const c of controllers) {
    for (const a of c.actions || []) {
      push({
        method: a.method,
        path: a.path,
        handler: c.name || a.controller,
        action: a.name,
        type: a.type,
        view: a.view,
        returnKind: a.returnKind,
        params: a.params,
        file: c.file || a.file,
        stack: "mvc",
      });
    }
  }

  for (const api of overview?.apis || []) {
    const path = api.path || "/";
    // Skip noisy "/" rows when we already have rich MVC data
    if (controllers.length && (path === "/" || path === "")) continue;

    const handler =
      api.controller ||
      (api.name && String(api.name).includes(".")
        ? String(api.name).split(".")[0]
        : null) ||
      handlerFromFile(api.file);

    const action =
      api.action ||
      (api.name && String(api.name).includes(".")
        ? String(api.name).split(".").slice(1).join(".")
        : api.name) ||
      path;

    push({
      method: api.method,
      path,
      handler,
      action,
      type: api.type || "api",
      file: api.file,
      stack: "api",
    });
  }

  rows.sort((a, b) => {
    const h = String(a.handler).localeCompare(String(b.handler));
    if (h !== 0) return h;
    const p = String(a.path).localeCompare(String(b.path));
    if (p !== 0) return p;
    return String(a.action).localeCompare(String(b.action));
  });

  return rows;
}

function normToken(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function matchEndpointDataEvidence(row, overview) {
  const handler = normToken(row.handler);
  const action = normToken(row.action);
  const flow = overview?.flow || {};
  const edges = [
    ...(Array.isArray(flow.dataFlow) ? flow.dataFlow : []),
    ...(Array.isArray(overview?.workingEvidence?.dataFlowEdges)
      ? overview.workingEvidence.dataFlowEdges
      : []),
  ];
  const modules = overview?.workingEvidence?.workingModules || [];
  const keyTables =
    (flow.layers || []).find((l) => /table/i.test(l.name || ""))?.items || [];

  // Prefer edges that mention this action/SP; only then fall back to handler-wide edges
  const actionEdges = action
    ? edges.filter((e) => {
        const blob = normToken(`${e.from} ${e.to} ${e.via} ${e.detail || ""}`);
        const viaBits = String(e.via || "")
          .split(/[,/]/)
          .map((x) => normToken(x))
          .filter(Boolean);
        return (
          blob.includes(action) ||
          viaBits.some((v) => v.includes(action) || action.includes(v))
        );
      })
    : [];

  const handlerEdges =
    !actionEdges.length && handler
      ? edges.filter((e) => {
          const blob = normToken(`${e.from} ${e.to} ${e.via} ${e.detail || ""}`);
          return blob.includes(handler);
        })
      : [];

  const matchedEdges = actionEdges.length ? actionEdges : handlerEdges;

  const matchedMod = modules.find((m) => {
    const n = normToken(m.name || m.menu || "");
    return n && handler && (n.includes(handler) || handler.includes(n));
  });

  const actionSps = (matchedMod?.storedProcedures || []).filter((sp) => {
    const n = normToken(sp);
    return action && (n.includes(action) || action.includes(n));
  });

  const tables = [
    ...new Set([
      ...matchedEdges.map((e) => e.to).filter(Boolean),
      ...((matchedMod?.tables || []).filter((t) => {
        const n = normToken(t);
        // Only tables whose names relate to this handler — never dump whole module
        return handler && (n.includes(handler) || handler.includes(n.slice(0, 6)));
      }) || []),
    ]),
  ];

  const sps = [
    ...new Set([
      ...matchedEdges.flatMap((e) =>
        String(e.via || "")
          .split(/[,/|;]/)
          .map((x) => x.trim())
          .filter(Boolean)
      ),
      ...actionSps.slice(0, 4),
    ]),
  ].filter((sp) => {
    const n = normToken(sp);
    const readAction = /^(get|list|fetch|load|find|search|index|query|read)/.test(action);
    if (!readAction) return true;
    if (/insert|update|delete|save|create|remove/.test(n) && !n.includes(action)) return false;
    return true;
  });

  const preferredSps = sps.filter((sp) => {
    const n = normToken(sp);
    return !action || n.includes(action) || action.includes(n);
  });
  const finalSps = preferredSps.length ? preferredSps : sps;

  let fallbackTable = null;
  if (!tables.length && row.handler && row.handler !== "—") {
    const hit = keyTables.find(
      (t) => normToken(t).includes(handler) || handler.includes(normToken(t).slice(0, 6))
    );
    fallbackTable = hit || null;
  }

  return {
    tables,
    sps: finalSps,
    fallbackTable,
    edgeDetail: matchedEdges[0]?.detail || "",
  };
}

/**
 * First step must not invent UI (no “opens Delete screen”).
 * Only describe what the scanned endpoint itself proves.
 */
function triggerLabelForEndpoint(row) {
  const method = String(row.method || "GET").toUpperCase();
  const path = row.path || "/";
  const action = String(row.action || "").toLowerCase();
  const view = row.view || "";
  const returnKind = String(row.returnKind || "").toLowerCase();

  if (view && method === "GET") {
    return `Client navigates to ${path}`;
  }
  if (/^delete|^remove/.test(action) || method === "DELETE") {
    return `Client calls ${method} ${path}`;
  }
  if (
    /^(add|create|insert|save|update|edit)/.test(action) ||
    ["POST", "PUT", "PATCH"].includes(method)
  ) {
    return `Client submits ${method} ${path}`;
  }
  if (/^(getall|list|index|fetch|load|find|search)/.test(action)) {
    return `Client requests ${method} ${path}`;
  }
  if (returnKind === "partial") {
    return `Client requests ${method} ${path} (partial response)`;
  }
  return `Client requests ${method} ${path}`;
}

function clientLayerLabel(row) {
  const view = row.view || "";
  const returnKind = String(row.returnKind || "").toLowerCase();
  const handler = row.handler || "Handler";
  const action = row.action || "action";

  if (view) return `View: ${view}`;
  if (returnKind === "partial") {
    return `Partial response (${returnKind}) — no dedicated “${action}” page in scan`;
  }
  if (returnKind === "view" || returnKind === "page") {
    return `View result (${returnKind}) for ${handler}/${action}`;
  }
  if (returnKind) return `Controller returns ${returnKind}`;
  return `No dedicated view linked for ${handler}/${action} in scan`;
}

/**
 * Vertical steps from scanned endpoint evidence only — no invented screens/buttons.
 */
function buildDetailFlowSteps(row, overview) {
  const method = String(row.method || "GET").toUpperCase();
  const path = row.path || "/";
  const handler = row.handler || "Handler";
  const action = row.action || "action";
  const purpose = row.purpose || inferEndpointPurpose(row);
  const returnKind = String(row.returnKind || "").toLowerCase();
  const view = row.view || "";
  const params = row.params || "";

  const controllerLabel = /controller/i.test(handler)
    ? `${handler}.${action}(${params || ""})`
    : `${handler}Controller.${action}(${params || ""})`;
  const { tables, sps, fallbackTable, edgeDetail } = matchEndpointDataEvidence(row, overview);

  const isDelete = /^delete|^remove/i.test(action) || /delete/i.test(purpose);
  const isRead =
    !isDelete &&
    (/fetch|list|read|detail|get/i.test(purpose) ||
      /^(get|list|index|fetch|load|find|search|view|show)/i.test(action));
  const isPageOpen = method === "GET" && !!view && !isDelete;

  let dataLabel = "Table / SP (not proven for this action in scan evidence yet)";
  if (sps.length && tables.length) {
    dataLabel = `SP: ${sps.slice(0, 2).join(", ")} → Table: ${tables.slice(0, 3).join(", ")}`;
  } else if (tables.length) {
    dataLabel = `Table: ${tables.slice(0, 3).join(", ")}`;
  } else if (sps.length) {
    dataLabel = `SP / data command: ${sps.slice(0, 3).join(", ")}`;
  } else if (fallbackTable) {
    dataLabel = `Naming hint only: ${fallbackTable} — confirm in Database step`;
  }

  let note = edgeDetail || "";
  if (!note) {
    if (isDelete) {
      note =
        "Scan shows a Delete action — not a Delete page. Any UI that calls this URL must come from a view/script reference in code, not assumed.";
    } else if (isPageOpen) {
      note = `Loads view ${view}. Separate POST/Save actions handle writes when present in code.`;
    } else if (isRead) {
      note = "Read/list action from method + action name in scan.";
    } else if (returnKind === "partial") {
      note = "Controller returns a partial (often ajax notification), not a full screen.";
    }
  }

  const dataAccessLabel = isDelete
    ? "Repository / data access (delete)"
    : isRead
      ? "Service / data access (read)"
      : "Service / data access";

  return {
    title: `${method} ${path} flow`,
    steps: [
      triggerLabelForEndpoint(row),
      clientLayerLabel(row),
      `${method} ${path}${params ? ` (${params})` : ""}`,
      controllerLabel,
      dataAccessLabel,
      dataLabel,
    ],
    note,
  };
}

function EndpointDetailFlow({ row, overview }) {
  const pack = useMemo(() => buildDetailFlowSteps(row, overview), [row, overview]);
  return (
    <div className={styles.endpointDetailFlow}>
      <p className={styles.endpointDetailFlowTitle}>{pack.title}</p>
      <div className={styles.endpointDetailFlowStack}>
        {pack.steps.map((step, i) => (
          <div key={`${i}-${step}`} className={styles.endpointDetailFlowItem}>
            <span className={styles.endpointDetailFlowLabel}>{step}</span>
            {i < pack.steps.length - 1 ? (
              <span className={styles.endpointDetailFlowDown} aria-hidden>
                ↓
              </span>
            ) : null}
          </div>
        ))}
      </div>
      {pack.note ? <p className={styles.endpointDetailFlowNote}>{pack.note}</p> : null}
    </div>
  );
}

function HandlerMenu({ value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selected = options.find((o) => o.value === value) || options[0];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={styles.handlerMenu} ref={rootRef}>
      <button
        type="button"
        id="endpoint-handler-select"
        className={`${styles.handlerMenuTrigger}${open ? ` ${styles.handlerMenuTriggerOpen}` : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.handlerMenuTriggerText}>{selected?.label}</span>
        <span className={styles.handlerMenuChevron} aria-hidden>
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open ? (
        <ul className={styles.handlerMenuList} role="listbox" aria-labelledby="endpoint-handler-select">
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <li key={opt.value} role="option" aria-selected={active}>
                <button
                  type="button"
                  className={`${styles.handlerMenuOption}${active ? ` ${styles.handlerMenuOptionActive}` : ""}`}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                >
                  <span>{opt.label}</span>
                  {active ? <span className={styles.handlerMenuCheck}>✓</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function EndpointsPanel({ overview }) {
  const allRows = useMemo(() => buildUnifiedEndpoints(overview), [overview]);
  const handlers = useMemo(() => {
    const set = new Set(allRows.map((r) => r.handler).filter((h) => h && h !== "—"));
    return ["__all__", ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [allRows]);

  const [handlerFilter, setHandlerFilter] = useState("__all__");
  const [page, setPage] = useState(1);
  const [openKey, setOpenKey] = useState(null);

  useEffect(() => {
    setHandlerFilter("__all__");
    setPage(1);
    setOpenKey(null);
  }, [overview]);

  useEffect(() => {
    setPage(1);
    setOpenKey(null);
  }, [handlerFilter]);

  if (!allRows.length) {
    return (
      <Section title="Endpoints" subtitle="Controllers, actions & APIs — one table for every stack">
        <p className={styles.empty}>No endpoints found from disk scan</p>
      </Section>
    );
  }

  const filtered =
    handlerFilter === "__all__"
      ? allRows
      : allRows.filter((r) => r.handler === handlerFilter);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / ACTIONS_PER_PAGE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * ACTIONS_PER_PAGE;
  const paged = filtered.slice(start, start + ACTIONS_PER_PAGE);

  const selectedHandler =
    handlerFilter !== "__all__"
      ? allRows.find((r) => r.handler === handlerFilter)
      : null;

  const handlerNames = handlers.filter((h) => h !== "__all__");
  const handlerCount = handlerNames.length;
  const mvcCount = allRows.filter((r) => r.stack === "mvc").length;
  const oneHandlerFile =
    handlerCount === 1
      ? (() => {
          const file = allRows.find((r) => r.handler === handlerNames[0])?.file;
          if (!file || file === "—") return null;
          const parts = String(file).replace(/\\/g, "/").split("/");
          return parts[parts.length - 1] || null;
        })()
      : null;

  const handlerOptions = (() => {
    const opts = [{ value: "__all__", label: `All handlers (${allRows.length})` }];
    for (const h of handlers) {
      if (h === "__all__") continue;
      const count = allRows.filter((r) => r.handler === h).length;
      opts.push({ value: h, label: `${h} (${count})` });
    }
    return opts;
  })();

  const routeLabel = allRows.length === 1 ? "API route" : "API routes";
  const groupLabel = handlerCount === 1 ? "handler group" : "handler groups";
  const endpointsSubtitle = [
    `${allRows.length} ${routeLabel} across ${handlerCount} ${groupLabel}${
      oneHandlerFile ? ` (${oneHandlerFile})` : ""
    }`,
    mvcCount ? `${mvcCount} from controllers/actions` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Section title="Endpoints" subtitle={endpointsSubtitle}>
      <div className={styles.mvcPanel}>
        <div className={styles.mvcToolbar}>
          <span className={styles.mvcLabel} id="endpoint-handler-label">
            Handler
          </span>
          <HandlerMenu
            value={handlerFilter}
            options={handlerOptions}
            onChange={setHandlerFilter}
          />
          {selectedHandler?.file ? (
            <span className={styles.mvcFilePath}>{selectedHandler.file}</span>
          ) : null}
        </div>

        <div className={styles.tableWrap}>
          <table className={`${styles.table} ${styles.mvcTable}`}>
            <thead>
              <tr>
                <th style={{ width: "22%" }}>Endpoint</th>
                <th style={{ width: "16%" }}>Handler</th>
                <th style={{ width: "16%" }}>Action</th>
                <th style={{ width: "22%" }}>Purpose</th>
                <th style={{ width: "24%" }}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {paged.length ? (
                paged.map((row, i) => {
                  const rowKey = `${row.method}-${row.path}-${row.handler}-${row.action}-${start + i}`;
                  const detail = row.view || row.file || "—";
                  const isOpen = openKey === rowKey;
                  return (
                    <Fragment key={rowKey}>
                      <tr>
                        <td>
                          <div className={styles.endpointCell}>
                            <span className={styles.method}>{row.method}</span>
                            <span className={styles.path} title={row.path}>
                              {row.path}
                            </span>
                          </div>
                        </td>
                        <td title={row.handler}>
                          <span className={styles.mvcClamp3}>{row.handler}</span>
                        </td>
                        <td title={row.action}>
                          <span className={styles.mvcClamp3}>{row.action}</span>
                        </td>
                        <td title={row.purpose}>
                          <span className={styles.mvcClamp3}>{row.purpose}</span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className={styles.endpointDetailBtn}
                            title={detail}
                            onClick={() => setOpenKey(isOpen ? null : rowKey)}
                          >
                            {detail === "—" ? "Flow" : detail}
                          </button>
                        </td>
                      </tr>
                      {isOpen ? (
                        <tr className={styles.endpointFlowRow}>
                          <td colSpan={5}>
                            <EndpointDetailFlow row={row} overview={overview} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={5} className={styles.empty}>
                    No endpoints for this handler
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {total > ACTIONS_PER_PAGE ? (
          <div className={styles.pager}>
            <span className={styles.pagerInfo}>
              Page {safePage} / {totalPages} · showing {start + 1}–
              {Math.min(start + ACTIONS_PER_PAGE, total)} of {total}
            </span>
            <div className={styles.pagerBtns}>
              <button
                type="button"
                className={styles.btnSecondary}
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                ← Prev
              </button>
              <button
                type="button"
                className={styles.btnSecondary}
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next →
              </button>
            </div>
          </div>
        ) : null}

        <p className={styles.mvcHint}>
          Click Detail for action → endpoint → Controller → Service → Table/SP flow
          (from disk + flow evidence).
        </p>
      </div>
    </Section>
  );
}

function titleCaseModule(name) {
  const s = String(name || "").trim();
  if (!s) return s;
  return s
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Parse "Net = A + B - C" into { result, terms, kind } */
function parseCalculationFormula(calc) {
  const formula = String(calc.formulaOrLogic || "").trim();
  const inputs = Array.isArray(calc.inputs) ? calc.inputs.filter(Boolean) : [];
  const resultGuess =
    String(calc.output || "")
      .replace(/^the\s+/i, "")
      .split(/[.|,]/)[0]
      .trim() ||
    String(calc.name || "")
      .replace(/\s*calculation\s*$/i, "")
      .trim() ||
    "Result";

  // Conditional / prose logic — show as one block, not equation terms
  if (/^\s*if\b/i.test(formula) || /\bthen\b/i.test(formula) || (!formula.includes("=") && formula.length > 80)) {
    return {
      kind: "logic",
      result: resultGuess,
      terms: inputs.map((label, i) => ({
        op: i === 0 ? "" : "+",
        label,
      })),
      logicText: formula,
    };
  }

  if (formula.includes("=")) {
    const eq = formula.indexOf("=");
    const left = formula.slice(0, eq).trim();
    const right = formula.slice(eq + 1).trim();
    const result = left || resultGuess;

    // Right side still has if/then or another = — treat as logic, not +/- terms
    if (/\bif\b/i.test(right) || /\bthen\b/i.test(right) || right.includes("=")) {
      return {
        kind: "logic",
        result: resultGuess || result,
        terms: inputs.map((label, i) => ({
          op: i === 0 ? "" : "+",
          label,
        })),
        logicText: formula,
      };
    }

    const terms = [];
    const parts = right.split(/(\s*[+\-]\s*)/).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 1) {
      terms.push({ op: "", label: parts[0] });
    } else {
      let pendingOp = "";
      for (const part of parts) {
        if (part === "+" || part === "-") {
          pendingOp = part;
          continue;
        }
        terms.push({ op: pendingOp || (terms.length ? "+" : ""), label: part });
        pendingOp = "";
      }
    }
    if (terms.length) return { kind: "equation", result, terms, logicText: "" };
  }

  if (inputs.length) {
    return {
      kind: "equation",
      result: resultGuess,
      terms: inputs.map((label, i) => ({
        op: i === 0 ? "" : "+",
        label,
      })),
      logicText: "",
    };
  }

  return {
    kind: formula ? "logic" : "equation",
    result: resultGuess,
    terms: [],
    logicText: formula,
  };
}

function parseCalcLocation(location) {
  const raw = String(location || "").split(",")[0].trim();
  if (!raw) return { file: "—", method: null };
  const file = raw.replace(/:\d+.*$/, "").trim();
  const base = file.split("/").pop() || file;
  return { file, base };
}

function inferCalcMethod(calc, parsed) {
  const snip = String(calc.snippet || "");
  const prop =
    snip.match(/public\s+\w+\s+(\w+)\s*\{/) ||
    snip.match(/function\s+(\w+)\s*\(/) ||
    snip.match(/(\w+)\s*\([^)]*\)\s*\{/);
  if (prop) return `${prop[1]}()`;

  const result = String(parsed.result || "")
    .replace(/\s+/g, "")
    .replace(/[^a-zA-Z0-9]/g, "");
  if (result) return `Calculate${result.charAt(0).toUpperCase()}${result.slice(1)}()`;
  return "calculation logic";
}

function formatCalcTitle(name) {
  const s = String(name || "").trim();
  if (!s) return "Calculation";
  // Keep existing mixed case; only fix ALL CAPS / snake_case
  if (s === s.toUpperCase() || /[_-]/.test(s)) {
    return s
      .replace(/[_-]+/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return s;
}

function CalculationCard({ calc }) {
  const parsed = parseCalculationFormula(calc);
  const { file, base } = parseCalcLocation(calc.location || calc.file);
  const method = inferCalcMethod(calc, parsed);
  const explain = String(calc.explanation || calc.description || "").trim();
  const isLogic = parsed.kind === "logic";
  const title = formatCalcTitle(calc.name || parsed.result);
  const equationLine =
    !isLogic && parsed.terms.length
      ? `${parsed.result} = ${parsed.terms
          .map((t, i) => `${i === 0 || !t.op ? "" : `${t.op} `}${t.label}`)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim()}`
      : null;

  return (
    <article className={styles.calcCard}>
      <header className={styles.calcCardHead}>
        <h3 className={styles.calcCardTitle}>{title}</h3>
        {explain ? <p className={styles.calcCardBlurb}>{explain}</p> : null}
      </header>

      <div className={styles.calcFormulaBoard}>
        {isLogic ? (
          <pre className={styles.calcLogicBlock}>{parsed.logicText || parsed.result}</pre>
        ) : (
          <p className={styles.calcEquationLine}>{equationLine || parsed.result}</p>
        )}
      </div>

      <dl className={styles.calcMetaList}>
        <div className={styles.calcMetaRow}>
          <dt>File</dt>
          <dd title={file}>{base || file}</dd>
        </div>
        <div className={styles.calcMetaRow}>
          <dt>Method</dt>
          <dd>{method}</dd>
        </div>
        {parsed.terms.length > 0 ? (
          <div className={styles.calcMetaRow}>
            <dt>Uses</dt>
            <dd>
              <div className={styles.calcChipRow}>
                {parsed.terms.map((t, i) => (
                  <span key={`in-${t.label}-${i}`} className={styles.calcChip}>
                    {t.label}
                  </span>
                ))}
              </div>
            </dd>
          </div>
        ) : null}
      </dl>

      {file && file !== "—" ? (
        <p className={styles.calcImplPath} title={calc.location || file}>
          {calc.location || file}
        </p>
      ) : null}
    </article>
  );
}

function formatBytes(n) {
  if (!n && n !== 0) return "—";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

async function readJson(res) {
  const raw = await res.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(raw?.slice(0, 200) || `HTTP ${res.status}`);
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const STEPS = ["upload", "overview", "flow", "module", "database"];

export default function HomePage() {
  const [step, setStep] = useState("upload");
  const [aiStatus, setAiStatus] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");

  const [projectId, setProjectId] = useState(null);
  const [overview, setOverview] = useState(null);

  const [selectedModule, setSelectedModule] = useState(null);
  const [moduleExplanation, setModuleExplanation] = useState(null);
  const [moduleLoading, setModuleLoading] = useState(false);
  const moduleExplainRef = useRef(null);
  const scrollToModuleExplainRef = useRef(false);

  const [dbUri, setDbUri] = useState("");
  const [dbAnalysis, setDbAnalysis] = useState(null);
  const [dbTablePage, setDbTablePage] = useState(1);
  const [calcPage, setCalcPage] = useState(1);

  useEffect(() => {
    fetch(`${apiBase()}/api/ai/status`)
      .then((r) => r.json())
      .then(setAiStatus)
      .catch(() =>
        setAiStatus({ configured: false, error: "API offline — run npm run dev" })
      );
  }, []);

  const onFile = useCallback((f) => {
    setError("");
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".zip")) {
      setError("Please upload a .zip of your project folder.");
      setFile(null);
      return;
    }
    setFile(f);
  }, []);

  const analyze = useCallback(async () => {
    if (!file) {
      setError("Choose a project .zip first.");
      return;
    }
    if (aiStatus && aiStatus.configured === false) {
      setError(
        aiStatus.error ||
          "AI not configured. Add your API key in server/.env and restart npm run dev."
      );
      return;
    }
    setLoading(true);
    setError("");
    setProgress("Uploading zip… scanning the project (this can take a minute)");
    try {
      const body = new FormData();
      body.append("project", file);
      const res = await fetch(`${apiBase()}/api/analyze`, { method: "POST", body });
      const data = await readJson(res);
      setProjectId(data.projectId);
      setOverview(data);
      setModuleExplanation(null);
      setSelectedModule(null);
      setDbAnalysis(null);
      setCalcPage(1);
      setStep("overview");
      setProgress("");
    } catch (e) {
      setError(e.message || "Analysis failed");
      setProgress("");
    } finally {
      setLoading(false);
    }
  }, [file, aiStatus]);

  const explainModule = useCallback(
    async (moduleName) => {
      if (!projectId || moduleLoading) return;
      setSelectedModule(moduleName);
      setModuleLoading(true);
      setError("");
      setStep("module");
      scrollToModuleExplainRef.current = true;
      try {
        const res = await fetch(`${apiBase()}/api/projects/${projectId}/modules/explain`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ module: moduleName }),
        });
        const data = await readJson(res);
        setModuleExplanation(data.explanation);
      } catch (e) {
        setError(e.message || "Module explain failed");
        scrollToModuleExplainRef.current = false;
      } finally {
        setModuleLoading(false);
      }
    },
    [projectId, moduleLoading]
  );

  useEffect(() => {
    if (moduleLoading || !moduleExplanation || step !== "module") return;
    if (!scrollToModuleExplainRef.current) return;
    scrollToModuleExplainRef.current = false;
    const id = window.setTimeout(() => {
      moduleExplainRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return () => window.clearTimeout(id);
  }, [moduleLoading, moduleExplanation, step, selectedModule]);

  const analyzeDb = useCallback(async () => {
    if (!projectId || !dbUri.trim()) {
      setError("Paste a PostgreSQL or MySQL connection string.");
      return;
    }
    setLoading(true);
    setError("");
    setProgress(
      "Connecting to database… reading schema in pages (step-by-step). This can take a few minutes."
    );
    try {
      const res = await fetch(`${apiBase()}/api/projects/${projectId}/database/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionString: dbUri.trim() }),
      });
      const data = await readJson(res);
      setDbAnalysis(data.analysis);
      setDbTablePage(1);
      setStep("database");
      setProgress("");
    } catch (e) {
      setError(e.message || "Database analysis failed");
      setProgress("");
    } finally {
      setLoading(false);
    }
  }, [projectId, dbUri]);

  const reset = useCallback(() => {
    const id = projectId;
    // Clear UI first so going back to Modules never waits on disk cleanup
    setStep("upload");
    setFile(null);
    setProjectId(null);
    setOverview(null);
    setSelectedModule(null);
    setModuleExplanation(null);
    setModuleLoading(false);
    setDbUri("");
    setDbAnalysis(null);
    setCalcPage(1);
    setDbTablePage(1);
    setError("");
    setProgress("");
    // New scan: wipe all extracts + saved projects (current + old leftovers)
    fetch(`${apiBase()}/api/cleanup`, { method: "POST" }).catch(() => {
      if (id) {
        fetch(`${apiBase()}/api/projects/${id}`, { method: "DELETE" }).catch(() => {});
      }
    });
  }, [projectId]);

  const calcTotal = overview?.calculations?.length || 0;
  const calcTotalPages = Math.max(1, Math.ceil(calcTotal / CALCS_PER_PAGE));
  const pagedCalcs = useMemo(() => {
    const list = overview?.calculations || [];
    const start = (calcPage - 1) * CALCS_PER_PAGE;
    return list.slice(start, start + CALCS_PER_PAGE);
  }, [overview, calcPage]);

  const moduleStepTreeData = useMemo(
    () => (overview ? modulesStepTree(overview) : []),
    [overview]
  );
  const dbTableTotal = dbAnalysis?.tables?.length || 0;
  const dbTableTotalPages = Math.max(1, Math.ceil(dbTableTotal / DB_TABLES_PER_PAGE));
  const pagedDbTables = useMemo(() => {
    const list = dbAnalysis?.tables || [];
    const start = (dbTablePage - 1) * DB_TABLES_PER_PAGE;
    return list.slice(start, start + DB_TABLES_PER_PAGE);
  }, [dbAnalysis, dbTablePage]);

  return (
    <main className={`${styles.page} ${step === "upload" ? styles.pageUpload : ""}`}>
      <div className={styles.gridBg} aria-hidden />

      <header className={`${styles.top} rise`}>
        <div className={styles.brand}>
          <img
            className={styles.brandLogo}
            src="/brand-logo.png?v=11"
            alt="CodeAtlas — Developer Project Assistant"
          />
        </div>
      </header>

      <nav className={styles.stepper} aria-label="Steps">
        {STEPS.map((s, i) => (
          <div
            key={s}
            className={`${styles.stepItem} ${step === s ? styles.stepActive : ""} ${
              STEPS.indexOf(step) > i ? styles.stepDone : ""
            }`}
          >
            <span>{i + 1}</span>
            {s}
          </div>
        ))}
      </nav>

      {error ? <p className={styles.errorBanner}>{error}</p> : null}
      {progress ? <p className={styles.progressBanner}>{progress}</p> : null}

      {step === "upload" && (
        <section className={`${styles.hero} rise`}>
          <div className={styles.heroCopy}>
            <p className={styles.kicker}>Project scan</p>
            <h1>
              Code<span>Atlas</span>
            </h1>
            <p className={styles.lede}>
              Upload any project zip. Explore overview → flow → modules → database — step by
              step.
            </p>
          </div>

          <div
            className={`${styles.drop} ${dragging ? styles.dropActive : ""} ${loading ? styles.dropBusy : ""}`}
            onDragEnter={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              onFile(e.dataTransfer.files?.[0]);
            }}
          >
            {loading ? <div className={styles.scanLine} aria-hidden /> : null}
            <div className={styles.dropInner}>
              <img
                className={styles.dropIcon}
                src="/brand-logo.png?v=11"
                alt="CodeAtlas — Developer Project Assistant"
              />
              <h2>{loading ? "Scanning project…" : "Choose a zip, then hit Analyze."}</h2>
              <p>
                {file
                  ? `${file.name} · ${formatBytes(file.size)}`
                  : "Drag & drop, or use Choose ZIP."}
              </p>
              <div className={styles.actions}>
                <label className={styles.btnSecondary}>
                  Choose ZIP
                  <input
                    type="file"
                    accept=".zip,application/zip"
                    hidden
                    disabled={loading}
                    onChange={(e) => onFile(e.target.files?.[0])}
                  />
                </label>
                <span
                  className={`${styles.analyzeWrap} ${!file && !loading ? styles.analyzeWrapHint : ""}`}
                  data-hint="First upload the project zip, then Analyze project"
                >
                  <button
                    type="button"
                    className={styles.btnPrimary}
                    disabled={!file || loading}
                    onClick={analyze}
                  >
                    {loading ? "Analyzing…" : "Analyze project"}
                  </button>
                </span>
              </div>
            </div>
          </div>
        </section>
      )}

      {step === "overview" && overview && (
        <div className={styles.reportWrap}>
          <div className={styles.reportHero}>
            <div>
              <p className={styles.kicker}>Step 1 · Overview</p>
              <h1 className={styles.reportTitle}>{overview.projectName}</h1>
              <p className={styles.metaLine}>{overview.summary}</p>
            </div>
            <div className={styles.reportActions}>
              <button type="button" className={styles.btnSecondary} onClick={reset}>
                New scan
              </button>
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={() => setStep("flow")}
              >
                Next: Flow →
              </button>
            </div>
          </div>

          <Section title="Technologies" subtitle="Detected from the project">
            <div className={styles.techGrid}>
              <div>
                <h3>Languages</h3>
                <div className={styles.chipRow}>
                  {(overview.technologies?.languages || []).map((x, i) => (
                    <Chip key={`lang-${x}-${i}`}>{x}</Chip>
                  ))}
                </div>
              </div>
              <div>
                <h3>Frameworks & Libraries</h3>
                <div className={styles.chipRow}>
                  {(overview.technologies?.frameworks || []).map((x, i) => (
                    <Chip key={`fw-${x}-${i}`} tone="accent">
                      {x}
                    </Chip>
                  ))}
                </div>
              </div>
              <div>
                <h3>Others</h3>
                <div className={styles.chipRow}>
                  {(overview.technologies?.others || []).map((x, i) => (
                    <Chip key={`other-${x}-${i}`} tone="warm">
                      {x}
                    </Chip>
                  ))}
                </div>
              </div>
            </div>
          </Section>

          <Section
            title="Modules"
            subtitle="Deep scan for any stack — nested folders / features / controllers"
          >
            <div className={styles.split}>
              <div>
                <h3>Packages (dependencies)</h3>
                <div className={styles.listScroll}>
                  <ul className={styles.monoList}>
                    {(overview.modules?.packages || []).map((p, i) => (
                      <li key={`${p}-${i}`}>{p}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <div>
                <h3>Module tree</h3>
                {(overview.modules?.tree || []).length > 0 ? (
                  <div className={styles.listScroll}>
                    <ModuleTree tree={overview.modules.tree} />
                  </div>
                ) : (
                  <div className={styles.chipRow}>
                    {(overview.modules?.internal || []).map((m, i) => (
                      <Chip key={`int-${m}-${i}`} tone="accent">
                        {m}
                      </Chip>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Section>

          <EndpointsPanel overview={overview} />

          <Section title="Database signals" subtitle="From code — live DB is a later step">
            <div className={styles.dbGrid}>
              {(overview.database || []).length ? (
                overview.database.map((db, i) => (
                  <article key={i} className={styles.dbCard}>
                    <h3>{db.name}</h3>
                    <p className={styles.orm}>{db.orm || "No ORM noted"}</p>
                    <ul className={styles.dbEvidence}>
                      {(db.evidence || []).map((e, j) => (
                        <li key={`${i}-${e}-${j}`}>{e}</li>
                      ))}
                    </ul>
                  </article>
                ))
              ) : (
                <p className={styles.empty}>No database signals in code</p>
              )}
            </div>
          </Section>

          {(overview.calculations || []).length > 0 && (
            <Section
              title="Calculations"
              subtitle={`${overview.calculations.length} formulas found in the project`}
            >
              <div className={styles.calcGrid}>
                {pagedCalcs.map((c, i) => (
                  <CalculationCard
                    key={`${c.name || "calc"}-${(calcPage - 1) * CALCS_PER_PAGE + i}`}
                    calc={c}
                  />
                ))}
              </div>
              {calcTotal > CALCS_PER_PAGE ? (
                <div className={`${styles.pager} ${styles.calcSectionPager}`}>
                  <span className={styles.pagerInfo}>
                    Page {calcPage} / {calcTotalPages} · showing{" "}
                    {(calcPage - 1) * CALCS_PER_PAGE + 1}–
                    {Math.min(calcPage * CALCS_PER_PAGE, calcTotal)} of {calcTotal}
                  </span>
                  <div className={styles.pagerBtns}>
                    <button
                      type="button"
                      className={styles.btnSecondary}
                      disabled={calcPage <= 1}
                      onClick={() => setCalcPage((p) => Math.max(1, p - 1))}
                    >
                      ← Prev
                    </button>
                    <button
                      type="button"
                      className={styles.btnSecondary}
                      disabled={calcPage >= calcTotalPages}
                      onClick={() => setCalcPage((p) => Math.min(calcTotalPages, p + 1))}
                    >
                      Next →
                    </button>
                  </div>
                </div>
              ) : null}
            </Section>
          )}
        </div>
      )}

      {step === "flow" && overview && (
        <div className={styles.reportWrap}>
          <div className={styles.reportHero}>
            <div>
              <p className={styles.kicker}>Step 2 · Overall project flow</p>
              <h1 className={styles.reportTitle}>Flow</h1>
              <p className={styles.metaLine}>
                {overview.flow?.headline ||
                  "How the whole system works end-to-end — process journey, not a module list"}
              </p>
            </div>
            <div className={styles.reportActions}>
              <button type="button" className={styles.btnSecondary} onClick={() => setStep("overview")}>
                ← Overview
              </button>
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={() => setStep("module")}
                disabled={
                  !(overview.modules?.feature?.length || overview.modules?.internal?.length)
                }
              >
                Next: Modules →
              </button>
            </div>
          </div>

          {!overview.flow ? (
            <Section title="Flow" subtitle="Not generated yet">
              <p className={styles.empty}>
                Flow was not part of this scan. Run a New scan to generate project + data flow.
              </p>
            </Section>
          ) : (
            <>
              {overview.flow.happyPath ? (
                <Section title="Happy path" subtitle="One-line overall journey">
                  <p className={styles.happyPath}>{overview.flow.happyPath}</p>
                </Section>
              ) : null}

              <Section
                title="Project flow"
                subtitle="Overall process — how work moves through the system"
              >
                {(overview.flow.projectFlow || []).length ? (
                  <ol className={styles.flowList}>
                    {(overview.flow.projectFlow || []).map((s, i) => (
                      <li key={i} className={styles.flowStep}>
                        <span className={styles.flowNum}>{s.step || i + 1}</span>
                        <div>
                          <strong>{s.title}</strong>
                          {s.actor ? <em className={styles.flowActor}>{s.actor}</em> : null}
                          <p>{s.detail}</p>
                          {(s.modules || []).length ? (
                            <p className={styles.flowEvidence}>
                              uses: {(s.modules || []).join(", ")}
                            </p>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className={styles.empty}>No overall flow generated</p>
                )}
              </Section>

              <Section
                title="Data flow"
                subtitle="How data moves across stages — live SPs / tables only"
              >
                {(overview.flow.dataFlow || []).length ? (
                  <div className={styles.dataFlowList}>
                    {(overview.flow.dataFlow || []).map((d, i) => (
                      <article key={i} className={styles.dataFlowEdge}>
                        <div className={styles.dataFlowPath}>
                          <span>{d.from}</span>
                          <span className={styles.dataFlowArrow}>→</span>
                          <span>{d.to}</span>
                        </div>
                        {d.via ? <em>via {d.via}</em> : null}
                        <p>{d.detail}</p>
                        {(d.evidence || []).length ? (
                          <p className={styles.flowEvidence}>
                            evidence: {(d.evidence || []).slice(0, 3).join(" · ")}
                          </p>
                        ) : null}
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className={styles.empty}>No data-flow edges from live SP/CRUD evidence</p>
                )}
              </Section>

              {(overview.flow.layers || []).length > 0 && (
                <Section title="Layers" subtitle="Architecture at a glance">
                  <div className={styles.layerGrid}>
                    {overview.flow.layers.map((layer, i) => (
                      <article key={i} className={styles.layerCard}>
                        <h3>{layer.name}</h3>
                        <ul>
                          {(layer.items || []).map((item, j) => (
                            <li key={`${i}-${item}-${j}`}>{item}</li>
                          ))}
                        </ul>
                      </article>
                    ))}
                  </div>
                </Section>
              )}

              {(overview.flow.notes || []).length > 0 && (
                <Section title="Notes">
                  <ul>
                    {overview.flow.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </Section>
              )}
            </>
          )}
        </div>
      )}

      {step === "module" && overview && (
        <div className={styles.reportWrap}>
          <div className={styles.reportHero}>
            <div>
              <p className={styles.kicker}>Step 3 · Module explanation</p>
              <h1 className={styles.reportTitle}>Modules</h1>
              <p className={styles.metaLine}>
                Click a module to see how it works
              </p>
            </div>
            <div className={styles.reportActions}>
              <button type="button" className={styles.btnSecondary} onClick={() => setStep("flow")}>
                ← Flow
              </button>
              <button type="button" className={styles.btnPrimary} onClick={() => setStep("database")}>
                Next: Database →
              </button>
            </div>
          </div>

          <Section
            title="Project modules"
            subtitle="Main features in this project"
          >
            {moduleStepTreeData.length > 0 ? (
              <div className={styles.modTreePanel}>
                <ModuleTree
                  tree={moduleStepTreeData}
                  clickable
                  selected={selectedModule}
                  onSelect={(path) => !moduleLoading && explainModule(path)}
                />
              </div>
            ) : (
              <p className={styles.empty}>No modules found</p>
            )}
          </Section>

          {moduleLoading ? (
            <div ref={moduleExplainRef} className={styles.moduleExplainAnchor}>
              <Section title={titleCaseModule(selectedModule) || "Module"}>
                <p className={styles.moduleOpening}>
                  Opening module: {titleCaseModule(selectedModule)}…
                </p>
              </Section>
            </div>
          ) : null}

          {!moduleLoading && moduleExplanation ? (
            <div ref={moduleExplainRef} className={styles.moduleExplainAnchor}>
            <Section title={titleCaseModule(moduleExplanation.module || selectedModule)}>
              <p className={styles.ledeBlock}>
                {moduleExplanation.inBrief || moduleExplanation.purpose}
              </p>

              {(moduleExplanation.howItWorks || moduleExplanation.responsibilities || []).length > 0 && (
                <div className={styles.moduleExplainBlock}>
                  <h3>How it works</h3>
                  <ul>
                    {(moduleExplanation.howItWorks || moduleExplanation.responsibilities || []).map((r, i) => (
                      <li key={`how-${i}`}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              {(moduleExplanation.screensInside || []).length > 0 && (
                <div className={styles.moduleExplainBlock}>
                  <h3>Inside this module</h3>
                  <ul className={styles.screenInsideList}>
                    {(moduleExplanation.screensInside || []).map((s, i) => (
                      <li key={`screen-${s.name || s}-${i}`}>
                        <strong>{s.name || s}</strong>
                        {s.does ? <span> — {s.does}</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {moduleExplanation.example ? (
                <div className={styles.moduleExplainBlock}>
                  <h3>Example</h3>
                  <p className={styles.ledeBlock}>{moduleExplanation.example}</p>
                </div>
              ) : null}

              {moduleExplanation.keyRule ? (
                <div className={styles.moduleExplainBlock}>
                  <h3>Key rule</h3>
                  <p className={styles.calcFormula}>{moduleExplanation.keyRule}</p>
                </div>
              ) : null}

              {(moduleExplanation.storedProcedures || []).length > 0 && (
                <div className={styles.moduleExplainBlock}>
                  <h3>Stored procedures</h3>
                  <ul className={styles.monoList}>
                    {moduleExplanation.storedProcedures.map((sp, i) => (
                      <li key={`sp-${sp}-${i}`}>{sp}</li>
                    ))}
                  </ul>
                </div>
              )}

              {(moduleExplanation.tablesOrLedger || []).length > 0 && (
                <div className={styles.moduleExplainBlock}>
                  <h3>Tables / ledger</h3>
                  <ul>
                    {moduleExplanation.tablesOrLedger.map((t, i) => (
                      <li key={`tbl-${t}-${i}`}>{t}</li>
                    ))}
                  </ul>
                </div>
              )}

              {(moduleExplanation.keyFiles || []).length > 0 && (
                <div className={styles.moduleExplainBlock}>
                  <h3>Key files</h3>
                  <ul className={styles.monoList}>
                    {moduleExplanation.keyFiles.map((f, i) => (
                      <li key={`file-${f}-${i}`}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}

              {(moduleExplanation.relatedModules || []).length > 0 && (
                <div className={styles.moduleExplainBlock}>
                  <h3>Related</h3>
                  <div className={styles.chipRow}>
                    {moduleExplanation.relatedModules.map((m, i) => (
                      <Chip key={`rel-${m}-${i}`} tone="warm">
                        {m}
                      </Chip>
                    ))}
                  </div>
                </div>
              )}
            </Section>
            </div>
          ) : null}
        </div>
      )}

      {step === "database" && overview && (
        <div className={styles.reportWrap}>
          <div className={styles.reportHero}>
            <div>
              <p className={styles.kicker}>Step 4 · Live database</p>
              <h1 className={styles.reportTitle}>Database</h1>
              <p className={styles.metaLine}>
                Paste a connection string — schema is read live (password not stored)
              </p>
            </div>
            <div className={styles.reportActions}>
              <button type="button" className={styles.btnSecondary} onClick={() => setStep("module")}>
                ← Modules
              </button>
              <button type="button" className={styles.btnSecondary} onClick={reset}>
                New scan
              </button>
            </div>
          </div>

          <Section
            title="Connection"
            subtitle="postgresql://, mysql://, mssql://, or SQL Server: Server=host,port;Database=db;User Id=…;Password=…"
          >
            <div className={styles.dbForm}>
              <input
                className={styles.input}
                type="password"
                autoComplete="off"
                placeholder="postgresql://… | mysql://… | Server=host;Database=db;User Id=…;Password=…"
                value={dbUri}
                onChange={(e) => setDbUri(e.target.value)}
                disabled={loading}
              />
              <button
                type="button"
                className={styles.btnPrimary}
                disabled={loading || !dbUri.trim()}
                onClick={analyzeDb}
              >
                {loading ? "Analyzing…" : "Analyze database"}
              </button>
            </div>
            {loading ? (
              <p className={styles.dbAnalyzingNote}>
                Analysis in progress — the button stays disabled until schema reading finishes. Please wait.
              </p>
            ) : null}
          </Section>

          {dbAnalysis && (
            <Section title="Tables">
              {dbTableTotal > DB_TABLES_PER_PAGE ? (
                <div className={styles.pager}>
                  <div className={styles.pagerBtns}>
                    <button
                      type="button"
                      className={styles.btnSecondary}
                      disabled={dbTablePage <= 1}
                      onClick={() => setDbTablePage((p) => Math.max(1, p - 1))}
                    >
                      ← Prev
                    </button>
                    <span className={styles.pagerInfo}>
                      {(dbTablePage - 1) * DB_TABLES_PER_PAGE + 1}–
                      {Math.min(dbTablePage * DB_TABLES_PER_PAGE, dbTableTotal)} of {dbTableTotal}
                    </span>
                    <button
                      type="button"
                      className={styles.btnSecondary}
                      disabled={dbTablePage >= dbTableTotalPages}
                      onClick={() => setDbTablePage((p) => Math.min(dbTableTotalPages, p + 1))}
                    >
                      Next →
                    </button>
                  </div>
                </div>
              ) : null}
              <div className={styles.dbGrid}>
                {pagedDbTables.map((t, ti) => (
                  <article key={`${t.name || "table"}-${ti}`} className={styles.dbCard}>
                    <h3>{t.name}</h3>
                    <p className={styles.orm}>{t.purpose}</p>
                    {(t.primaryKey || []).length > 0 && (
                      <p className={styles.calcMeta}>
                        PK: {(t.primaryKey || []).join(", ")}
                        {t.rowCount != null ? ` · rows: ${t.rowCount}` : ""}
                      </p>
                    )}
                    {(t.importantColumns || []).length > 0 && (
                      <ul>
                        {(t.importantColumns || []).map((c, ci) => (
                          <li key={`${t.name}-col-${ci}`}>{c}</li>
                        ))}
                      </ul>
                    )}
                    {(t.relationships || []).length > 0 && (
                      <>
                        <p className={styles.calcMeta}>Outgoing FKs</p>
                        <ul>
                          {(t.relationships || []).map((r, ri) => (
                            <li key={`${t.name}-out-${ri}`}>{r}</li>
                          ))}
                        </ul>
                      </>
                    )}
                    {(t.inboundRelationships || []).length > 0 && (
                      <>
                        <p className={styles.calcMeta}>Referenced by</p>
                        <ul>
                          {(t.inboundRelationships || []).map((r, ri) => (
                            <li key={`${t.name}-in-${ri}`}>{r}</li>
                          ))}
                        </ul>
                      </>
                    )}
                  </article>
                ))}
              </div>
            </Section>
          )}
        </div>
      )}
    </main>
  );
}
