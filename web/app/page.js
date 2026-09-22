"use client";

import { useCallback, useEffect, useMemo, useRef, useState, Fragment } from "react";
import styles from "./page.module.css";

const apiBase = () =>
  (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");

const DB_TABLES_PER_PAGE = 8;
const ACTIONS_PER_PAGE = 10;
const CALCS_PER_PAGE = 5;

/**
 * Folder name → display lines (joining with "_" restores the original name).
 * smart_city_react_native_citizen →
 *   smart_city
 *   react_native
 *   citizen
 */
function formatProjectTitleLines(name) {
  const raw = String(name || "project").trim();
  if (!raw) return ["project"];

  const delim = raw.includes("_") ? "_" : raw.includes("-") ? "-" : null;
  if (!delim) return [raw];

  const parts = raw.split(delim).filter(Boolean);
  if (parts.length <= 1) return [raw];
  if (parts.length === 2) return [parts.join(delim)];
  if (parts.length === 3) return [parts.slice(0, 2).join(delim), parts[2]];

  // Pair left-to-right into up to 3 lines (5 parts → 2+2+1)
  const lines = [];
  let i = 0;
  while (i < parts.length) {
    if (lines.length >= 2) {
      lines.push(parts.slice(i).join(delim));
      break;
    }
    const take = Math.min(2, parts.length - i);
    lines.push(parts.slice(i, i + take).join(delim));
    i += take;
  }
  return lines;
}

function ProjectTitle({ name }) {
  const full = String(name || "project").trim() || "project";
  const lines = useMemo(() => formatProjectTitleLines(full), [full]);
  return (
    <h1 className={styles.reportTitle} title={full}>
      {lines.map((line, i) => (
        <span key={`${i}-${line}`} className={styles.reportTitleLine}>
          {line}
        </span>
      ))}
    </h1>
  );
}

/** Shared hero — fixed spacing on every step (short or long summary) */
function ReportStepHero({ kicker, title, summary, children }) {
  return (
    <div className={styles.reportHero}>
      <p className={styles.kicker}>{kicker}</p>
      <ProjectTitle name={title} />
      <div className={styles.reportHeroBottom}>
        <div className={styles.reportHeroSummary}>
          <p className={styles.metaLine}>{summary}</p>
        </div>
        <div className={styles.reportActions}>{children}</div>
      </div>
    </div>
  );
}

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

function NavTreeBranch({ node, depth = 0 }) {
  const kids = node.children || [];
  return (
    <div className={styles.navTreeNode} style={{ marginLeft: depth ? 18 : 0 }}>
      <div className={styles.navTreeRow}>
        {depth > 0 ? (
          <span className={styles.navTreeElbow} aria-hidden>
            └
          </span>
        ) : null}
        <span className={styles.navTreeLabel}>{node.name}</span>
      </div>
      {kids.length ? (
        <div className={styles.navTreeChildren}>
          {kids.map((c, i) => (
            <NavTreeBranch key={`${node.name}-${c.name}-${i}`} node={c} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ScreenNavTree({ navigation }) {
  const tree = navigation?.tree || [];
  if (!tree.length) {
    return (
      <p className={styles.empty}>No screen / route navigation tree proven in this scan.</p>
    );
  }
  return (
    <div className={styles.navTreeCard}>
      <div className={styles.navTree}>
        {tree.map((n, i) => (
          <NavTreeBranch key={`${n.name}-${i}`} node={n} depth={0} />
        ))}
      </div>
      {navigation?.pattern ? (
        <p className={styles.navFlowPattern}>{navigation.pattern}</p>
      ) : null}
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

function stackLabelsForRow(row) {
  const file = String(row.file || row.view || "").replace(/\\/g, "/");
  const stack = String(row.stack || "").toLowerCase();

  if (stack === "mvc" || /Controller\.cs$/i.test(file) || /\.cshtml$/i.test(file)) {
    return { handlerLabel: "Controller" };
  }
  if (
    stack.includes("react_native") ||
    stack.includes("react-native") ||
    /\/(screens|components)\//i.test(file)
  ) {
    return { handlerLabel: "Screen / handler" };
  }
  if (
    stack === "next" ||
    stack.includes("next") ||
    /route\.(js|ts)$/i.test(file) ||
    /\/app\/api\//i.test(file) ||
    /\/pages\/api\//i.test(file) ||
    /\/api\//i.test(file)
  ) {
    return { handlerLabel: "Route handler" };
  }
  if (/\.dart$/i.test(file) || stack.includes("flutter") || stack.includes("dart")) {
    return { handlerLabel: "Screen / handler" };
  }
  if (/\.py$/i.test(file) || stack.includes("python") || stack.includes("django") || stack.includes("flask")) {
    return { handlerLabel: "View / endpoint" };
  }
  return { handlerLabel: "Handler" };
}

/**
 * Detail card — API endpoint + controller/handler only.
 */
function buildEndpointEvidencePack(row) {
  const method = String(row.method || "GET").toUpperCase();
  const path = row.path || "/";
  const handler = row.handler && row.handler !== "—" ? row.handler : null;
  const action = row.action && row.action !== "—" ? row.action : null;
  const file = row.file || "";
  const params = row.params || "";
  const labels = stackLabelsForRow(row);

  const apiValue = `${method} ${path}${params ? ` (${params})` : ""}`;

  let handlerValue = "Not proven in scan";
  let handlerProven = false;
  if (handler && action) {
    const fn = `${handler}.${action}()`;
    handlerValue = file ? `${file} → ${fn}` : fn;
    handlerProven = true;
  } else if (file) {
    handlerValue = file;
    handlerProven = true;
  }

  return {
    title: `Endpoint: ${method} ${path}`,
    layers: [
      { label: "Endpoint", value: apiValue, proven: true },
      { label: labels.handlerLabel, value: handlerValue, proven: handlerProven },
    ],
  };
}

function EndpointDetailFlow({ row }) {
  const pack = useMemo(() => buildEndpointEvidencePack(row), [row]);
  return (
    <div className={styles.endpointDetailFlow}>
      <p className={styles.endpointDetailFlowTitle}>{pack.title}</p>
      <div className={styles.evidenceCard}>
        {pack.layers.map((layer) => (
          <div key={layer.label} className={styles.evidenceLayer}>
            <span className={styles.evidenceLayerLabel}>{layer.label}</span>
            <span
              className={`${styles.evidenceLayerValue} ${
                layer.proven ? "" : styles.evidenceLayerUnproven
              }`}
            >
              {layer.value}
            </span>
          </div>
        ))}
      </div>
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
                            <EndpointDetailFlow row={row} />
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

const STEPS = ["upload", "overview", "flow", "module", "database", "access"];

const STEP_LABELS = {
  upload: "Upload",
  overview: "Overview",
  flow: "Flow",
  module: "Module",
  database: "Database",
  access: "Access",
};

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
      if (data.accessNav) {
        setOverview((prev) => (prev ? { ...prev, accessNav: data.accessNav } : prev));
      }
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
  const hasDbSignals = (overview?.database || []).length > 0;
  // Live DB required only when code shows DB signals; otherwise Access uses code scan.
  const accessUnlocked = Boolean(dbAnalysis) || !hasDbSignals;
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
            <span className={styles.stepNum}>{i + 1}</span>
            <span className={styles.stepLabel}>{STEP_LABELS[s] || s}</span>
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
              Upload any project zip. Explore overview → flow → modules → database → access — step by
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
          <ReportStepHero
            kicker="Step 1 · Overview"
            title={overview.projectName}
            summary={overview.summary}
          >
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
          </ReportStepHero>

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
            title="Architecture"
            subtitle="Request path inferred from folders in this zip — layers only when present"
          >
            {overview.architecture?.pattern ? (
              <div className={styles.archCard}>
                <ol className={styles.archFlow}>
                  {[
                    ...(overview.architecture.layers || []),
                    ...(/→\s*Response$/i.test(overview.architecture.pattern || "")
                      ? ["Response"]
                      : []),
                  ].map((layer, i, arr) => (
                    <li key={`${layer}-${i}`} className={styles.archStep}>
                      <span className={styles.archStepLabel}>{layer}</span>
                      {i < arr.length - 1 ? (
                        <span className={styles.archArrow} aria-hidden>
                          ↓
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ol>
                <p className={styles.archPatternLine}>{overview.architecture.pattern}</p>
                {overview.architecture.note ? (
                  <p className={styles.archNote}>{overview.architecture.note}</p>
                ) : null}
              </div>
            ) : (
              <p className={styles.empty}>
                {overview.architecture?.note ||
                  "Not enough folder signals to infer architecture for this project."}
              </p>
            )}
          </Section>

          <Section
            title="Dependencies & features"
            subtitle="Packages the project uses, plus features found from controllers, screens, and folders"
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
                <h3>Feature tree</h3>
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
          <ReportStepHero
            kicker="Step 2 · Overall project flow"
            title="Flow"
            summary={
              overview.flow?.headline ||
              "How the whole system works end-to-end — process journey, not a module list"
            }
          >
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
          </ReportStepHero>

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
                    {overview.flow.layers.map((layer, i) => {
                      const items = layer.items || [];
                      const name = String(layer.name || "");
                      let emptyMsg = "Nothing found in scan evidence";
                      if (/procedure|sp\b/i.test(name)) {
                        emptyMsg = "No live procedures from scan evidence";
                      } else if (/table/i.test(name)) {
                        emptyMsg = "No key tables from scan evidence";
                      } else if (/journey|user/i.test(name)) {
                        emptyMsg = "No user-journey steps from scan evidence";
                      }
                      return (
                        <article key={i} className={styles.layerCard}>
                          <h3>{layer.name}</h3>
                          {items.length ? (
                            <ul>
                              {items.map((item, j) => (
                                <li key={`${i}-${item}-${j}`}>{item}</li>
                              ))}
                            </ul>
                          ) : (
                            <p className={styles.empty}>{emptyMsg}</p>
                          )}
                        </article>
                      );
                    })}
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
          <ReportStepHero
            kicker="Step 3 · Module explanation"
            title="Modules"
            summary="Click a module below to see how it works — what it does, screens inside, and key rules from this project's code."
          >
            <button type="button" className={styles.btnSecondary} onClick={() => setStep("flow")}>
              ← Flow
            </button>
            <button type="button" className={styles.btnPrimary} onClick={() => setStep("database")}>
              Next: Database →
            </button>
          </ReportStepHero>

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
          <ReportStepHero
            kicker="Step 5 · Live database"
            title="Database"
            summary={
              hasDbSignals
                ? "Paste a connection string and analyze to unlock Access (roles & permissions from live tables). Passwords are not stored — only a redacted label is kept."
                : "No database signals in this zip — Access is available from code (roles/permissions/navigation). Optional: still paste a connection string if you have a live DB."
            }
          >
            <button type="button" className={styles.btnSecondary} onClick={() => setStep("module")}>
              ← Modules
            </button>
            <button
              type="button"
              className={styles.btnPrimary}
              disabled={!accessUnlocked}
              title={
                !accessUnlocked
                  ? "Analyze the database first (this project has database signals in code)"
                  : undefined
              }
              onClick={() => accessUnlocked && setStep("access")}
            >
              Next: Access →
            </button>
          </ReportStepHero>

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
            ) : !hasDbSignals ? (
              <p className={styles.dbAnalyzingNote}>
                No database signals in code — Access is unlocked using roles, permissions, and screen
                navigation from the zip. Live DB analyze is optional.
              </p>
            ) : !dbAnalysis ? (
              <p className={styles.dbAnalyzingNote}>
                This project has database signals — Access unlocks after Analyze database (roles from
                live tables).
              </p>
            ) : (
              <p className={styles.dbAnalyzingNote}>
                Database analyzed — Access is unlocked for roles, permissions, and screen navigation.
              </p>
            )}
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

      {step === "access" && overview && (
        <div className={styles.reportWrap}>
          {!accessUnlocked ? (
            <>
              <ReportStepHero
                kicker="Step 6 · Access & navigation"
                title="Access"
                summary="Analyze a live database first so roles and permissions come from real tables — not guesses from code."
              >
                <button type="button" className={styles.btnPrimary} onClick={() => setStep("database")}>
                  ← Go to Database
                </button>
                <button type="button" className={styles.btnSecondary} onClick={reset}>
                  New scan
                </button>
              </ReportStepHero>
              <p className={styles.empty}>
                Access is locked until you paste a connection string and click Analyze database.
              </p>
            </>
          ) : (
            <>
          <ReportStepHero
            kicker="Step 6 · Access & navigation"
            title="Access"
            summary={
              dbAnalysis
                ? "Roles and permissions from live database tables when present. Screen navigation is a branched tree from screens/routes in the zip — nothing invented."
                : "No database signals in this project — roles, permissions, and navigation are from code evidence only (not invented)."
            }
          >
            <button type="button" className={styles.btnSecondary} onClick={() => setStep("database")}>
              ← Database
            </button>
            <button type="button" className={styles.btnSecondary} onClick={reset}>
              New scan
            </button>
          </ReportStepHero>

          <Section
            title="Roles"
            subtitle={
              overview.accessNav?.roleCount
                ? `${overview.accessNav.roleCount} role(s) from ${overview.accessNav.rolesSource || "scan"}`
                : dbAnalysis
                  ? "Distinct values from Role / RoleMaster (or similar) tables in the live DB"
                  : "Role names from code (enums, Authorize, Role.*) — no live DB"
            }
          >
            {(overview.accessNav?.roles || []).length ? (
              <div className={styles.chipRow}>
                {overview.accessNav.roles.map((r, i) => (
                  <Chip key={`role-${r}-${i}`} tone="accent">
                    {r}
                  </Chip>
                ))}
              </div>
            ) : (
              <p className={styles.empty}>
                {dbAnalysis
                  ? "No role values found in live DB tables matching Role / RoleMaster / UserRole."
                  : "No role names proven in code for this zip."}
              </p>
            )}
          </Section>

          <Section
            title="Permissions"
            subtitle={
              overview.accessNav?.permissionCount
                ? `${overview.accessNav.permissionCount} permission(s) from ${overview.accessNav.permissionsSource || "scan"}`
                : dbAnalysis
                  ? "Distinct values from Permission / UserPermission (or similar) tables"
                  : "Permission strings / claims from code — no live DB"
            }
          >
            {(overview.accessNav?.permissions || []).length ? (
              <div className={styles.chipRow}>
                {overview.accessNav.permissions.map((p, i) => (
                  <Chip key={`perm-${p}-${i}`} tone="warm">
                    {p}
                  </Chip>
                ))}
              </div>
            ) : (
              <p className={styles.empty}>
                {dbAnalysis
                  ? "No permission values found in live DB tables matching Permission / claims."
                  : "No permission keys proven in code for this zip."}
              </p>
            )}
          </Section>

          <Section
            title="Screen navigation"
            subtitle="Branched map from screens / features on disk (like a screen-flow diagram)"
          >
            <ScreenNavTree navigation={overview.accessNav?.navigation} />
          </Section>

          {(overview.accessNav?.notes || []).length > 0 && (
            <Section title="Notes">
              <ul>
                {overview.accessNav.notes.map((n, i) => (
                  <li key={`access-note-${i}`}>{n}</li>
                ))}
              </ul>
            </Section>
          )}

          {(overview.accessNav?.evidence || []).length > 0 && (
            <Section title="Evidence" subtitle="Tables/columns and files used for this step">
              <ul className={styles.monoList}>
                {overview.accessNav.evidence.map((e, i) => (
                  <li key={`access-ev-${i}`}>{e}</li>
                ))}
              </ul>
            </Section>
          )}
            </>
          )}
        </div>
      )}
    </main>
  );
}
