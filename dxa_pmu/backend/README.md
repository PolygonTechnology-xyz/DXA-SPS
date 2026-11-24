# DXA PMU backend

FastAPI + PostgreSQL + the Anthropic API. JSON is camelCase and matches the frontend's `Project` type, so
the frontend can swap its mock store for these calls. Interactive docs: http://localhost:8000/docs

## Run

```bash
cd backend
uv venv .venv && uv pip install -p .venv/bin/python -r requirements.txt   # or: python -m venv .venv && pip install -r requirements.txt
cp .env.example .env            # add ANTHROPIC_API_KEY
docker compose up -d db         # from the repo root: PostgreSQL
.venv/bin/uvicorn app.main:app --reload --port 8000
```

Or `docker compose up --build` from the repo root to start `db`, `backend` and `frontend` together.
Tables are created on startup (`create_all`); add Alembic when the schema starts changing.

## Connecting the frontend

The browser only talks to the Next.js app; `frontend/next.config.ts` proxies `/api/*` to this server
(`BACKEND_URL`, default `http://localhost:8000`; `http://backend:8000` in Docker). No CORS setup is needed.
Start the backend, then `npm run dev` in `frontend/`. Changing `BACKEND_URL` needs a restart of the dev server.

## API (all under `/api`)

| | |
|---|---|
| `GET/POST /projects`, `GET/PATCH/DELETE /projects/{id}` | Projects. `POST` takes `{name, goal}`. `PATCH` takes name, goal, status, files, `reportSchedule`. |
| `POST /projects/{id}/jira` | Body `{siteUrl, email, apiToken, projectKey}`. Verifies the login and project, **saves the login (token encrypted)**, imports tasks. 401/404/502 carry a user-readable `detail`. |
| `POST /projects/{id}/jira/refresh` | Re-imports tasks with the saved login, nothing to re-enter. |
| `DELETE /projects/{id}/jira` | Disconnects and deletes the saved login. |
| `POST /chat/create-project` | Body `{messages:[{role,content}]}` (whole history). Returns `{reply, projectName, goal, ready}`; when `ready`, call `POST /projects`. |
| `POST /projects/{id}/chat` | Same body; answers questions about the project's tasks. |
| `POST /projects/{id}/analysis` | Figures computed in code, assessment written by Claude (`aiGenerated: false` and rule-based text if the AI is unavailable). |
| `POST /projects/{id}/reports` | Analyse now and create a PDF (manual). |
| `GET /reports?project_id=` / `GET /reports/{id}/download` | List and download PDFs. |

`reportSchedule` is `{enabled, frequency: "monthly"|"quarterly"|"custom", from?, to?}`. A scheduler inside the API
process checks hourly and creates each due period exactly once (unique key in the database), refreshing Jira data first.
Monthly and quarterly reports cover the previous finished month or quarter; custom ones are created once the end date passes.

## Notes

- **Claude**: `claude-opus-5-5` (`ANTHROPIC_MODEL`), structured outputs via `messages.parse`, refusals handled, server-side
  refusal fallback requested by default (`ANTHROPIC_FALLBACKS=false` to turn off). Jira text is passed as delimited data
  with an instruction to ignore instructions inside it.
- **Security**: Jira addresses must be public https hosts (IP literals, localhost and private networks are refused).
  There is **no authentication yet**: put the API behind your login before exposing it.
- **Not built yet**: document upload and analysis, Global Knowledges endpoints, multi-user ownership.

## Tests

Need a PostgreSQL (the tests drop and recreate their tables, so never point `DATABASE_URL` at real data):

```bash
docker run -d --rm --name pmu-test-db -p 55432:5432 -e POSTGRES_PASSWORD=test -e POSTGRES_DB=pmu_test postgres:16-alpine
.venv/bin/python -m pytest -q
```
