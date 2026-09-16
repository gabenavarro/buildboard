# buildboard

A whiteboard + decision database + subagent runner for planning build-outs together with your AI.

- **Whiteboard** — a structured node graph (typed nodes: note, concept, task, plan, decision, agent_task) connected by edges.
- **Decision database** — SQLite storage for discussions, decisions, and concepts, designed to expose *compact* context to agents so it never overwhelms a context window.
- **Subagents** — spawn opencode subagents from a board node to expand a concept or plan in detail; results stream back and write themselves onto the board.
- **MCP server** — exposes the board and database to your opencode session so the agent can read/write it directly during a conversation.

## Status

Under active development. Milestones:

- [x] M0 — SQLite schema + board CRUD API
- [x] M1 — Board UI (node graph, persistence)
- [x] M2 — Threads, decisions, concepts + search + brief
- [x] M3 — Subagent runner (streaming, write-back)
- [ ] M4 — MCP server + integration
- [ ] M5 — Polish (minimap, export, tests)

## Developing

```sh
npm install
npm run dev        # http://localhost:5173
```

Production build (node adapter):

```sh
npm run build
node build/index.js
```

The SQLite database lives at `data/buildboard.db` (override with `BUILDBOARD_DB`).

## API (v1)

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/health` | Health check + table inventory |
| GET | `/api/items` | List items (`?kind=&tag=&status=&parent_id=`) |
| POST | `/api/items` | Create item |
| GET | `/api/items/:id` | Get one item |
| PATCH | `/api/items/:id` | Update item fields |
| DELETE | `/api/items/:id` | Delete item |
| GET | `/api/edges` | List edges |
| POST | `/api/edges` | Create edge |
| DELETE | `/api/edges/:id` | Delete edge |
| GET | `/api/threads` | List threads (`?item_id=`) |
| POST | `/api/threads` | Create thread |
| DELETE | `/api/threads/:id` | Delete thread |
| GET | `/api/threads/:id/messages` | List messages in a thread |
| POST | `/api/threads/:id/messages` | Post a message |
| GET | `/api/decisions` | List decisions (`?item_id=&status=`) |
| POST | `/api/decisions` | Record a decision |
| PATCH | `/api/decisions/:id` | Update/supersede a decision |
| DELETE | `/api/decisions/:id` | Delete a decision |
| GET | `/api/concepts` | List concepts |
| POST | `/api/concepts` | Create a concept |
| PATCH | `/api/concepts/:id` | Update a concept |
| DELETE | `/api/concepts/:id` | Delete a concept |
| GET | `/api/search` | Full-text search (`?q=&limit=&source=`) |
| GET | `/api/brief` | Compact context digest (~200 tokens) |
| GET | `/api/agent-tasks` | List agent tasks |
| POST | `/api/agent-tasks` | Spawn a subagent (`item_id` and/or `prompt`, `agent`, `model`) |
| GET | `/api/agent-tasks/:id` | Get one agent task |
| POST | `/api/agent-tasks/:id` | Cancel a running task |
| GET | `/api/agent-tasks/:id/events` | SSE stream of the agent's output |

The subagent runner shells out to `opencode run --format json --agent <agent> --dir <dir>`.
The working directory defaults to the app's CWD; override with `BUILDBOARD_AGENT_DIR`.
Permissions are never auto-approved — a running subagent behaves like an ordinary opencode agent.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run check` | Typecheck (svelte-check) |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit tests |
