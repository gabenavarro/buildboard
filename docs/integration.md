# table-talk ⇄ buildboard integration

buildboard is the **canonical store**. table-talk (a chat-side CLI) records
decisions, glossary terms, and tasks *into* buildboard, so a single record is
reachable from three surfaces:

- **chat** — by its short `ref` (4 hex chars)
- **the board** — as a card with a live thread
- **any agent** — via the MCP server or the REST API

This is the "one record · three surfaces · one loop · one handle" design: a
side-effect lives in exactly one store function per transition, so chat, board,
and agent can't drift.

## The `ref`

Every item, decision, and concept carries a short globally-unique `ref`
(4 lowercase hex chars, e.g. `a3f9`). buildboard assigns it; table-talk echoes
it. `resolveRef(ref)` looks up items → decisions → concepts in that order, so a
ref is addressable from anywhere.

## Mapping

| table-talk        | buildboard                                              |
| ----------------- | ------------------------------------------------------- |
| `action` (decision) | `item(kind=decision)` + `decisions` row (same ref)     |
| `term` (jargon)     | `concepts` (deduped by name, case-insensitive)         |
| `task` (work)       | `item(kind=task)` (canonical `[tt] <what>` title)       |
| `progress`          | `item.pct` (0–100; 100 → `status=done`) + body note     |
| `--blocked-on`      | `edge(kind=blocks)` + `status=blocked` (unblocks on resolve) |
| `done <ref>`        | resolve decision (choice) / mark task item `done`        |

## Enable board mode

Set `BUILDBOARD_URL` (or pass `--board http://…`) so table-talk writes to the
board instead of its local JSONL:

```sh
export BUILDBOARD_URL=http://localhost:5173
table-talk action "Ship it?" --why "user need" --rec "yes"
# -> a3f9
table-talk done a3f9 --choice yes
table-talk term "Cache" --intuitive "memoized store" --technical "fast lookup table"
table-talk task "write docs"
table-talk progress <ref> "half way" --pct 50
```

`table-talk status` reports whether board mode is on and reachable.

## REST

- `POST /api/decide` — record a decision (returns `ref`, item, decision)
- `POST /api/decisions/<ref>/resolve` — `{ choice }` resolves + unblocks dependents
- `POST /api/tasks` — record a task (returns `ref`, item)
- `POST /api/concepts/upsert` — upsert a concept by name (returns concept)
- `PATCH /api/items/<id>` — `{ pct, status, body_md, … }`
- `POST /api/edges` — `{ from_id, to_id, kind: 'blocks', board_id }`
- `GET /api/ref/<ref>` — resolve a ref to `{ source, id, ref, title, status, board_id }`

## Live board

`GET /api/boards/<id>/events` streams SSE `change` events. The canvas subscribes
and diff-refreshes (skips re-render when the snapshot is unchanged). In dev mode
the canvas polls (a long-lived SSE stream breaks vite on reload); in production
SSE gives instant updates. A `blocked` card shows a "⊘ waiting on #ref" footer
that focuses the blocking decision.

## MCP

`bb_decide`, `bb_decision_resolve`, `bb_decision_get`, `bb_spawn_agent`,
`bb_concept_add` (idempotent upsert), plus the standard item/edge/board tools.
Agent writes appear on the board without a reload.
