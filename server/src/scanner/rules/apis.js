/** API / route detection patterns across ecosystems */
export const API_PATTERNS = [
  // Express / Connect style
  {
    re: /\b(?:app|router|server)\.(get|post|put|patch|delete|options|head|all)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
    framework: "Express-like",
  },
  // NestJS decorators
  {
    re: /@(Get|Post|Put|Patch|Delete|Options|Head|All)\s*\(\s*['"`]?([^'"`)\s]*)['"`]?\s*\)/gi,
    framework: "NestJS",
  },
  // FastAPI / Flask / Starlette
  {
    re: /@(?:app|router)\.(get|post|put|patch|delete|options|head)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
    framework: "Python web",
  },
  {
    re: /@(?:Get|Post|Put|Patch|Delete|Options|Head|APIRoute)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
    framework: "Python FastAPI-like",
    methodFromMatch: false,
    pathGroup: 1,
    methodFromDecorator: true,
  },
  // Spring
  {
    re: /@(Get|Post|Put|Patch|Delete|Request)Mapping\s*\(\s*(?:value\s*=\s*)?['"`]([^'"`]+)['"`]/gi,
    framework: "Spring",
  },
  {
    re: /@(Get|Post|Put|Patch|Delete)Mapping\s*\(\s*\)/gi,
    framework: "Spring",
    pathFallback: "/",
  },
  // ASP.NET attributes
  {
    re: /\[Http(Get|Post|Put|Patch|Delete|Head|Options)(?:\s*\(\s*['"`]([^'"`]*)['"`]\s*\))?\]/gi,
    framework: "ASP.NET",
  },
  {
    re: /\.Map(Get|Post|Put|Patch|Delete|Methods)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
    framework: "ASP.NET Minimal APIs",
  },
  // Laravel
  {
    re: /Route::(get|post|put|patch|delete|options|any)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
    framework: "Laravel",
  },
  // Rails
  {
    re: /\b(get|post|put|patch|delete)\s+['"`]([^'"`]+)['"`]/gi,
    framework: "Rails",
    onlyIfPath: /routes\.rb$/i,
  },
  // Go gin/echo/fiber/chi style
  {
    re: /\.(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
    framework: "Go HTTP",
  },
  // PHP Slim
  {
    re: /\$app->(get|post|put|patch|delete|options)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
    framework: "Slim",
  },
  // Axios / fetch client endpoints (weaker signal — still useful)
  {
    re: /\b(?:axios|api|http|client)\.(get|post|put|patch|delete)\s*\(\s*['"`]((?:\/|https?:)[^'"`]+)['"`]/gi,
    framework: "HTTP client",
    clientOnly: true,
  },
  // fetch('/api/...')
  {
    re: /\bfetch\s*\(\s*['"`]((?:\/api\/|\/v\d+\/)[^'"`]+)['"`]/gi,
    framework: "fetch",
    methodFixed: "GET",
    pathGroup: 1,
  },
];

// Next.js App Router API route files: app/api/.../route.ts
export const NEXT_APP_ROUTE = /(?:^|\/)app\/(api(?:\/.*)?)\/route\.(js|ts|jsx|tsx)$/i;

// Next.js Pages API: pages/api/...
export const NEXT_PAGES_API = /(?:^|\/)pages\/api\/(.+)\.(js|ts|jsx|tsx)$/i;

/** ASP.NET Controllers folder hint */
export const ASPNET_CONTROLLER = /Controllers\/.+\.cs$/i;

/** OpenAPI path extraction */
export const OPENAPI_PATH_RE = /['"`]?(\/[A-Za-z0-9_\-{}./:]+)['"`]?\s*:\s*\{[^}]*?\b(get|post|put|patch|delete|options|head)\b/gi;
