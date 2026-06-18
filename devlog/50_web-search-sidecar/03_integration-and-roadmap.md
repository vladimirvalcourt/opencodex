# Integration points, risks, roadmap

> Source: `Backend` employee analysis (codex-rs + opencodex read-through) + boss synthesis.

## Integration points

| File / module | Change | Rationale |
|---------------|--------|-----------|
| `src/responses/parser.ts` — `buildTools()` | Replace the web_search **drop** with a synthetic `web_search` function tool **+ stash** the hosted config (`external_web_access`/`filters`/`search_context_size`/`search_content_types`) | Re-expose search to chat models; keep config to replay into the sidecar |
| `src/responses/parser.ts` — input loop | Handle `type:"web_search_call"` items in `input[]` | Multi-turn history (so turn 2+ doesn't re-search) |
| `src/types.ts` | `OcxTool.webSearch?: boolean`; `OcxParsedRequest._webSearchTool?` (stashed hosted config); `WebSearchSidecarResult` | Type flags for intercept + stash |
| `src/server.ts` — `handleResponses()` | Agentic loop; snapshot `forwardAuth` (authorization + chatgpt-account-id) from `IncomingMeta`; run sidecar between main adapter calls | Orchestration hub |
| `src/bridge.ts` | `emitWebSearchCall()` helper; optional `annotations` passthrough on `output_text` | Codex TUI parity + citations |
| `src/adapters/openai-responses.ts` | Export `FORWARD_HEADERS`; add `parsePassthroughResponse()` for sidecar JSON | Reuse the forward path for the sidecar |
| `src/config.ts` | `webSearchSidecar?: { enabled, model, reasoning, provider, timeoutMs, enabledFor }` | Opt-in + tuning |
| **NEW** `src/web-search/index.ts` | Public exports | Module boundary |
| **NEW** `src/web-search/executor.ts` | Sidecar Responses call via the forward adapter | Core search execution |
| **NEW** `src/web-search/parse.ts` | Parse sidecar `output[]` → answer + actions + sources/annotations | Result extraction |
| **NEW** `src/web-search/synthetic-tool.ts` | Build the synthetic function schema from the hosted tool | Single source for the exposed tool shape |
| **NEW** `src/web-search/format-result.ts` | Tool-result text injected into the main model | Consistent prompt across providers |

(`src/adapters/openai-chat.ts` / `anthropic.ts`: no change if the loop lives in the server — just
ensure a `web_search` `toolResult` round-trips, which they already do.)

## Risks / edge cases

| Risk | Mitigation |
|------|------------|
| Not logged into ChatGPT | Gate sidecar on snapshotted `authorization`; return explicit tool-result text ("search unavailable"), never crash the turn |
| Forward 400 (model/entitlement) | Catch upstream error; surface in tool_result; main turn continues |
| Timeouts | `timeoutMs` (default 30s) on the sidecar fetch; inject a timeout tool_result |
| Cost | Every search = an extra gpt-5.4-mini call; tag `requestLog` with `sidecar:true` |
| Loop prevention | Sidecar request carries ONLY the web_search tool (no function tools); cap searches/turn (config, default 3) |
| `search_context_size` / filters / location | Replay verbatim from the stashed hosted tool |
| Citations | Phase 1: markdown links in tool_result; Phase 4: `annotations` on final message |
| `open_page` / `find_in_page` | Phase 3: per-action sidecar prompt templates |
| Parallel tool calls | Execute sidecar first, or reject parallel web_search (honor Codex `parallel_tool_calls`) |
| Passthrough routes (`gpt-*`) | **Skip** sidecar entirely when `adapter.passthrough` — native search already works |

## Phased roadmap

**Phase 1 — Minimal viable sidecar (inject text)**
- `buildTools`: synthetic `web_search` function + stash hosted config.
- `web-search/executor.ts`: non-streaming sidecar to `gpt-5.4-mini`, `reasoning.effort:"minimal"`.
- `handleResponses` loop: detect web_search call → sidecar → inject tool_result → re-call main model.
- Auth gate on snapshotted `authorization`.
- **Verify:** `anthropic/claude-*` or `opencode-go/*` under Codex `web_search="live"` actually searches.

**Phase 2 — Streaming UX + error hardening**
- Emit `web_search_call` in_progress/completed to the Codex TUI; timeout + retry-once; structured
  error tool-results; `requestLog` sidecar cost/latency; unit tests for `parse.ts` on real fixtures.

**Phase 3 — Sources, actions, config**
- Parse `url_citation` sources; support `open_page`/`find_in_page`; `config.webSearchSidecar` opt-in
  (default on when a forward provider exists); replay `search_context_size`/`filters`/`user_location`.

**Phase 4 — History + citation passthrough**
- Ingest `web_search_call` from `input[]`; populate `annotations` on `output_text` (not `[]`);
  optional sources block appended for the Codex markdown renderer.

**Phase 5 — Production polish**
- Per-provider toggles (`enabledFor: ["opencode-go","anthropic","xai"]`); rate limit / max searches;
  opencodex GUI indicator ("search via gpt-5.4-mini sidecar"); integration test with mocked forward
  `web_search_call` fixtures.

## Open questions (decide before Phase 1)

1. **Loop home** — agentic loop in `handleResponses` (server) vs inside each adapter? Plan favors the
   server (one place, adapter-agnostic).
2. **Default-on vs opt-in** — ship Phase 1 behind `webSearchSidecar.enabled` (default off) until
   verified, then flip default-on when a forward provider is configured.
3. **Sidecar model fixed vs configurable** — default `gpt-5.4-mini`; allow override
   (`webSearchSidecar.model`) in case a cheaper/newer mini appears.
4. **Account scoping** — confirm the snapshotted ChatGPT `authorization` is valid for a second
   concurrent Responses call within the same turn (rate limits / session reuse).
