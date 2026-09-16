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
- [x] M4 — MCP server + integration
- [x] M5 — Polish (minimap, export, multi-board, tests)

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

The SQLite database lives at `data/buildboard.db` relative to the buildboard repo root
(override with `BUILDBOARD_DB`).

## API (v1)

Item/edge endpoints accept `?board=<id>` to scope to a board (default `default`).

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/health` | Health check + table inventory |
| GET | `/api/boards` | List boards |
| POST | `/api/boards` | Create a board |
| PATCH | `/api/boards/:id` | Rename a board |
| DELETE | `/api/boards/:id` | Delete an empty board |
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
| GET | `/api/agent-tasks` | List agent tasks (`?item_id=&limit=`) |
| POST | `/api/agent-tasks` | Spawn a subagent (`item_id` and/or `prompt`, `agent`, `model`) |
| GET | `/api/agent-tasks/:id` | Get one agent task |
| POST | `/api/agent-tasks/:id` | Cancel a running task |
| GET | `/api/agent-tasks/:id/events` | SSE stream of the agent's output |

The subagent runner shells out to `opencode run --format json --agent <agent> --dir <dir>`.
The working directory defaults to the buildboard repo root (resolved from the app's own
location, not `process.cwd()`); override with `BUILDBOARD_AGENT_DIR`.
Permissions are never auto-approved — a running subagent behaves like an ordinary opencode agent.

## Usage

- **New item** — top-left palette picks the node kind; the node is created at the cursor.
- **Select** — click a node to open the side panel (Item / Thread / Decisions / Concept / Agent tabs). Click the canvas to deselect.
- **Reposition** — drag a node; the position is persisted on release.
- **Connect** — drag from a node's edge handle to another node.
- **Delete** — select a node or edge and press `Delete`/`Backspace`.
- **Minimap** — bottom-right corner of the canvas.
- **Export** — the "Export .md" button downloads the current board as markdown.
- **Boards** — the top-bar switcher lists boards; `＋` creates one, `✕` deletes an empty one.

## MCP server

buildboard ships a stdio MCP server so your opencode session can read/write the board
directly during a conversation.

Tools: `bb_brief`, `bb_search`, `bb_item_list`, `bb_item_get`, `bb_item_upsert`,
`bb_edge_add`, `bb_decision_add`, `bb_decision_list`, `bb_message_add`, `bb_messages`,
`bb_spawn_agent`.

Register it in your `opencode.json` (or the project's `opencode.json`):

```json
{
	"$schema": "https://opencode.ai/config.json",
	"mcp": {
		"buildboard": {
			"type": "local",
			"command": ["npm", "--prefix", "/path/to/buildboard", "run", "mcp"],
			"enabled": true
		}
	}
}
```

The server uses the same `data/buildboard.db` as the app (override with `BUILDBOARD_DB`),
so anything written through MCP shows up on the board immediately. Paths resolve from the
buildboard repo root (found by walking up from the bundle's own location), not the invoking
directory, so spawning `dist/mcp/server.mjs` from any working directory keeps a single
database.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run check` | Typecheck (svelte-check) |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit tests |
| `npm run mcp` | Bundle + run the MCP server (stdio) |
| `npm run seed` | Seed a small demo board (skips if items already exist) |
| `npm run seed:reset` | Delete the database, then seed a fresh demo board |
| `npm run db:reset` | Delete `data/buildboard.db` + `-wal`/`-shm` sidecars |
| `npm run db:backup` | Copy the database to `data/backups/buildboard-<timestamp>.db*` |

`npm run db:backup` is a plain file copy of the database (and its WAL/SHM
sidecars, if present). It is only safe when no writer is active — stop the
dev server (and MCP server) before taking a backup. To restore, copy the
timestamped file back to `data/buildboard.db`. The `node:sqlite` backup API
is the alternative for online backups.
