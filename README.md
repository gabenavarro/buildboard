# buildboard

A whiteboard + decision database + subagent runner for planning build-outs together with your AI.

- **Whiteboard** — a structured node graph (typed nodes: note, concept, task, plan, decision, agent_task) connected by edges.
- **Decision database** — SQLite storage for discussions, decisions, and concepts, designed to expose *compact* context to agents so it never overwhelms a context window.
- **Subagents** — spawn opencode subagents from a board node to expand a concept or plan in detail; results stream back and write themselves onto the board.
- **MCP server** — exposes the board and database to your opencode session so the agent can read/write it directly during a conversation.

## Status

Under active development. Milestones:

- [ ] M0 — SQLite schema + board CRUD API
- [ ] M1 — Board UI (node graph, persistence)
- [ ] M2 — Threads, decisions, concepts + search + brief
- [ ] M3 — Subagent runner (streaming, write-back)
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

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run check` | Typecheck (svelte-check) |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit tests |
