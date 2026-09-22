# CodeAtlas (AI)

Upload any project `.zip` — **AI** scans the codebase and walks you through results step by step.

## Providers (pick one in `.env`)

| `AI_PROVIDER` | Key env var | Default model |
|---|---|---|
| `openai` | `OPENAI_API_KEY` | `gpt-4o-mini` |
| `openrouter` | `OPENROUTER_API_KEY` | `openai/gpt-4o-mini` |
| `gemini` | `GEMINI_API_KEY` | `gemini-2.0-flash` |

Copy `server/.env.example` → `server/.env` and paste your key.

## Run

```bash
npm run install:all
npm run dev
```

- UI: http://localhost:3000  
- API: http://localhost:4000  

## Flow

1. **Upload** zip → AI overview (name, tech, modules, APIs, database signals, calculations)
2. **Flow** → overall process journey + data movement (accurate SPs/tables) — not a Modules list copy
3. **Modules** → click a module → AI explanation
4. **Database** → paste `postgresql://`, `mysql://`, `mssql://`, or SQL Server ADO.NET (`Server=…;Database=…;…`) → live schema + AI analysis

Everything is stored locally as JSON:

`server/data/projects/<projectId>/project.json`

Extracted source (for follow-up asks) lives under `server/data/extracts/`.

## Notes

- Large zips upload **directly to Express** (`NEXT_PUBLIC_API_URL`), not through Next.js.
- AI cannot ingest multi‑GB binaries raw; the server builds a full-project **digest** (tree + source/config) and sends that to the model.
- DB passwords are **not** saved — only a redacted URI label is stored.
