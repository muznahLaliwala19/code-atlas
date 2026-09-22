import {
  LANGUAGE_BY_EXT,
  FRAMEWORK_FILE_RULES,
  NPM_DEP_RULES,
  PYTHON_DEP_RULES,
  COMPOSER_DEP_RULES,
  GEM_RULES,
  GO_DEP_RULES,
  RUST_DEP_RULES,
  JAVA_CONTENT_RULES,
  DOTNET_CONTENT_RULES,
  FLUTTER_CONTENT_RULES,
} from "./rules/technologies.js";

function add(set, value) {
  if (value && typeof value === "string") set.add(value);
}

function parsePackageJson(content) {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function collectNpmDeps(pkg) {
  const deps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.peerDependencies,
    ...pkg.optionalDependencies,
  };
  return Object.keys(deps || {});
}

function parseRequirements(content) {
  return content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split(/[=<>!~\[]/)[0].trim().toLowerCase())
    .filter(Boolean);
}

function parsePyproject(content) {
  const names = [];
  const depBlocks = content.match(/\[project\.dependencies\][\s\S]*?(?=\n\[|$)/i);
  // PEP 621 list form
  const listMatch = content.match(/dependencies\s*=\s*\[([\s\S]*?)\]/i);
  if (listMatch) {
    for (const m of listMatch[1].matchAll(/['"]([A-Za-z0-9_.\-]+)/g)) {
      names.push(m[1].toLowerCase());
    }
  }
  // poetry
  for (const m of content.matchAll(/^([A-Za-z0-9_.\-]+)\s*=/gm)) {
    if (!["name", "version", "description", "authors", "license"].includes(m[1])) {
      /* too noisy — skip */
    }
  }
  for (const m of content.matchAll(/^\s*([A-Za-z0-9_.\-]+)\s*=\s*["'{]/gm)) {
    names.push(m[1].toLowerCase());
  }
  if (depBlocks) {
    /* ignore */
  }
  return [...new Set(names)];
}

function parseComposer(content) {
  try {
    const json = JSON.parse(content);
    return Object.keys({ ...json.require, ...json["require-dev"] }).filter(
      (k) => k !== "php"
    );
  } catch {
    return [];
  }
}

function parseGoMod(content) {
  const mods = [];
  for (const m of content.matchAll(/^\s*((?:github\.com|golang\.org|gopkg\.in|go\.[^\s]+)\/[^\s]+)/gm)) {
    mods.push(m[1]);
  }
  return mods;
}

function parseCargo(content) {
  const deps = [];
  let inDeps = false;
  for (const line of content.split(/\r?\n/)) {
    if (/^\[dependencies\]/i.test(line) || /^\[dev-dependencies\]/i.test(line)) {
      inDeps = true;
      continue;
    }
    if (/^\[/.test(line)) {
      inDeps = false;
      continue;
    }
    if (inDeps) {
      const m = line.match(/^([A-Za-z0-9_-]+)\s*=/);
      if (m) deps.push(m[1]);
    }
  }
  return deps;
}

function parseGemfile(content) {
  const gems = [];
  for (const m of content.matchAll(/gem\s+['"]([^'"]+)['"]/gi)) {
    gems.push(m[1].toLowerCase());
  }
  return gems;
}

function parsePubspec(content) {
  const deps = [];
  let inDeps = false;
  for (const line of content.split(/\r?\n/)) {
    if (/^dependencies\s*:/i.test(line) || /^dev_dependencies\s*:/i.test(line)) {
      inDeps = true;
      continue;
    }
    if (/^[a-zA-Z_]/.test(line) && line.includes(":") && !/^\s/.test(line)) {
      inDeps = false;
    }
    if (inDeps) {
      const m = line.match(/^\s{2,}([A-Za-z0-9_]+)\s*:/);
      if (m && m[1] !== "sdk") deps.push(m[1]);
    }
  }
  return deps;
}

/**
 * Detect languages, frameworks, others.
 */
export function detectTechnologies(files) {
  const languages = new Set();
  const frameworks = new Set();
  const others = new Set();
  const packages = new Set();

  const langCounts = new Map();

  for (const f of files) {
    const lang = LANGUAGE_BY_EXT[f.ext];
    if (lang) {
      langCounts.set(lang, (langCounts.get(lang) || 0) + 1);
    }

    const norm = f.rel.replace(/\\/g, "/");

    for (const rule of FRAMEWORK_FILE_RULES) {
      if (rule.match.test(norm)) {
        if (rule.category === "framework") frameworks.add(rule.name);
        else if (rule.category === "other") others.add(rule.name);
        else others.add(rule.name);
      }
    }

    // package.json
    if (f.base === "package.json" && f.content) {
      const pkg = parsePackageJson(f.content);
      if (pkg) {
        if (pkg.name) others.add(`npm:${pkg.name}`);
        const deps = collectNpmDeps(pkg);
        for (const d of deps) {
          packages.add(d);
          for (const rule of NPM_DEP_RULES) {
            if (d === rule.pkg || d.startsWith(rule.pkg + "/")) {
              frameworks.add(rule.name);
            }
          }
        }
        // scripts heuristics
        const scripts = JSON.stringify(pkg.scripts || {});
        if (/next/.test(scripts)) frameworks.add("Next.js");
        if (/react-native|expo/.test(scripts)) frameworks.add("React Native");
        if (/ng\s|angular/.test(scripts)) frameworks.add("Angular");
      }
    }

    if (
      (f.base === "requirements.txt" || f.base === "requirements-dev.txt") &&
      f.content
    ) {
      languages.add("Python");
      for (const dep of parseRequirements(f.content)) {
        packages.add(dep);
        for (const rule of PYTHON_DEP_RULES) {
          if (dep === rule.pkg || dep.replace("_", "-") === rule.pkg) {
            frameworks.add(rule.name);
          }
        }
      }
    }

    if (f.base === "pyproject.toml" && f.content) {
      languages.add("Python");
      for (const dep of parsePyproject(f.content)) {
        packages.add(dep);
        for (const rule of PYTHON_DEP_RULES) {
          if (dep === rule.pkg || dep.replace("_", "-") === rule.pkg) {
            frameworks.add(rule.name);
          }
        }
      }
    }

    if (f.base === "composer.json" && f.content) {
      languages.add("PHP");
      for (const dep of parseComposer(f.content)) {
        packages.add(dep);
        for (const rule of COMPOSER_DEP_RULES) {
          if (dep === rule.pkg || dep.startsWith(rule.pkg.split("/")[0])) {
            if (dep.includes(rule.pkg) || dep === rule.pkg) frameworks.add(rule.name);
          }
          if (dep === rule.pkg) frameworks.add(rule.name);
        }
      }
    }

    if (f.base === "go.mod" && f.content) {
      languages.add("Go");
      for (const dep of parseGoMod(f.content)) {
        packages.add(dep);
        for (const rule of GO_DEP_RULES) {
          if (dep.startsWith(rule.pkg)) frameworks.add(rule.name);
        }
      }
    }

    if (f.base === "Cargo.toml" && f.content) {
      languages.add("Rust");
      for (const dep of parseCargo(f.content)) {
        packages.add(dep);
        for (const rule of RUST_DEP_RULES) {
          if (dep === rule.pkg) frameworks.add(rule.name);
        }
      }
    }

    if (f.base === "Gemfile" && f.content) {
      languages.add("Ruby");
      for (const gem of parseGemfile(f.content)) {
        packages.add(gem);
        for (const rule of GEM_RULES) {
          if (gem === rule.pkg) frameworks.add(rule.name);
        }
      }
    }

    if (f.base === "pubspec.yaml" && f.content) {
      languages.add("Dart");
      frameworks.add("Flutter");
      for (const dep of parsePubspec(f.content)) {
        packages.add(dep);
      }
      for (const rule of FLUTTER_CONTENT_RULES) {
        if (rule.match.test(f.content)) frameworks.add(rule.name);
      }
    }

    if ((f.ext === ".csproj" || f.ext === ".fsproj") && f.content) {
      languages.add("C#");
      frameworks.add(".NET");
      for (const rule of DOTNET_CONTENT_RULES) {
        if (rule.match.test(f.content)) frameworks.add(rule.name);
      }
    }

    if ((f.base === "pom.xml" || f.base.endsWith(".gradle") || f.base.endsWith(".gradle.kts")) && f.content) {
      languages.add("Java");
      for (const rule of JAVA_CONTENT_RULES) {
        if (rule.match.test(f.content)) frameworks.add(rule.name);
      }
      if (/com\.android|android\s*{/i.test(f.content)) frameworks.add("Android");
    }

    if (f.content) {
      for (const rule of JAVA_CONTENT_RULES) {
        if (f.ext === ".java" || f.ext === ".kt" || f.ext === ".xml" || f.ext === ".gradle") {
          if (rule.match.test(f.content)) frameworks.add(rule.name);
        }
      }
      for (const rule of DOTNET_CONTENT_RULES) {
        if (f.ext === ".cs" || f.ext === ".csproj") {
          if (rule.match.test(f.content)) frameworks.add(rule.name);
        }
      }
      if (f.ext === ".dart") {
        for (const rule of FLUTTER_CONTENT_RULES) {
          if (rule.match.test(f.content)) frameworks.add(rule.name);
        }
      }
    }
  }

  // Languages by frequency (ignore headers-only noise)
  const sortedLangs = [...langCounts.entries()]
    .filter(([name, count]) => count >= 1 && name !== "C/C++ Header")
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);

  for (const l of sortedLangs) languages.add(l);

  // Clean noise: remove npm:projectName from others into nothing useful
  const othersClean = [...others].filter((o) => !o.startsWith("npm:"));

  // Prefer framework names without duplicates
  return {
    languages: [...languages],
    frameworks: [...frameworks].sort(),
    others: [...new Set(othersClean)].sort(),
    packages: [...packages].sort(),
  };
}
