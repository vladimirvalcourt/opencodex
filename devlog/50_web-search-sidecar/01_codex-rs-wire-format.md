# codex-rs web_search wire format (grounded)

Source of truth (read by the `Backend` employee + boss):
- `codex-rs/tools/src/tool_spec.rs` — `ToolSpec::WebSearch` (request tool serialization)
- `codex-rs/core/src/tools/hosted_spec.rs` — `create_web_search_tool()` (how the fields are filled)
- `codex-rs/core/src/web_search.rs` + `core/src/event_mapping.rs` — action handling
- `codex-rs/core/src/event_mapping_tests.rs` — `parses_web_search_call` (response item shape)
- `codex-rs/protocol/src/models.rs`, `codex-api/src/sse/responses.rs` — `ResponseItem::WebSearchCall`, annotations

## 1. Request side — the `web_search` tool entry

`ToolSpec::WebSearch` is `#[serde(rename = "web_search")]`, so in the Responses request `tools[]` it
serializes as a bare hosted tool (NOT a function):

```jsonc
// one entry inside the request "tools": [ ... ]
{
  "type": "web_search",
  "external_web_access": true,           // live ⇒ true, cached ⇒ false, disabled ⇒ tool omitted
  "filters": { "allowed_domains": ["docs.rs", "github.com"] },   // optional
  "user_location": { "type": "approximate", "country": "US", "city": "...", "region": "...", "timezone": "..." }, // optional
  "search_context_size": "medium",       // "low" | "medium" | "high" (optional)
  "search_content_types": ["text"]       // or ["text","image"] (optional)
}
```

Field origin (`create_web_search_tool`, hosted_spec.rs):
- `web_search_mode`: `Live → external_web_access:true`, `Cached → false`, `Disabled/None → tool not created`.
- `filters`, `user_location`, `search_context_size` come from `WebSearchConfig`.
- `search_content_types`: `Text → omitted`, `TextAndImage → ["text","image"]`.

**Key fact:** Codex emits this on EVERY turn when `web_search` is enabled — the model decides whether
to actually call it. opencodex sees this entry in `parseRequest` and currently discards it.

## 2. Response side — `web_search_call` output items

When the (server-side) search runs, the Responses stream emits `web_search_call` output items.
Shape (from `ResponseItem::WebSearchCall` + `parses_web_search_call`):

```jsonc
// streamed as response.output_item.added / .done, type "web_search_call"
{
  "type": "web_search_call",
  "id": "ws_1",
  "status": "in_progress",     // then "completed"
  "action": {                  // null while partial ⇒ treated as "other"
    "type": "search",          // "search" | "open_page" | "find_in_page"
    "query": "weather",        // Search: query (or queries[])
    "queries": null
  }
}
```

Action variants (`WebSearchAction`):

| action `type`  | fields                | Codex display detail                |
|----------------|-----------------------|-------------------------------------|
| `search`       | `query` / `queries[]` | the query (or `"first ..."`)        |
| `open_page`    | `url`                 | the url                             |
| `find_in_page` | `url`, `pattern`      | `'pattern' in url`                  |
| `other`        | —                     | (partial / unknown)                 |

## 3. Sources / citations

The model's textual answer carries citations as **annotations** on `output_text` (url_citation
style), surfaced in `codex-api/src/sse/responses.rs` / `protocol/models.rs`. Concretely:

```jsonc
{
  "type": "output_text",
  "text": "... according to NOAA ...",
  "annotations": [
    { "type": "url_citation", "url": "https://...", "title": "...", "start_index": 4, "end_index": 18 }
  ]
}
```

opencodex's bridge currently emits `output_text` with `annotations: []` — for full parity the sidecar
must carry these citations through (Phase 4).

## 4. What this means for opencodex

- **Detect** the `{type:"web_search"}` entry in the incoming request `tools[]` (today: dropped).
- **Re-shape** it for a chat model as a callable **function** tool (so anthropic/openai-chat models
  can invoke it) — keep the hosted config (`external_web_access`, `filters`, `search_context_size`,
  `search_content_types`) stashed to replay into the sidecar's REAL `web_search` tool.
- **Emit** `web_search_call` items back toward Codex (so the TUI shows the search) and carry
  `annotations` for citations.
