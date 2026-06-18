# Web Search Sidecar — overview (PLAN ONLY)

> Status: **plan / scaffolding**. No implementation in this folder. Co-developed with the `Backend`
> employee (codex-rs analysis + architecture review); grounded in the real codex-rs source at
> `/Users/jun/Developer/codex/openai-codex/codex-rs` and the cross-agent study at
> `/Users/jun/Developer/codex/14_web-search/`.

## Problem

Codex always offers the model a **server-side** `web_search` tool (executed by the OpenAI Responses
API, never client-side). opencodex's Responses parser **drops** it for every non-OpenAI provider:

```
src/responses/parser.ts:124
  // web_search and image_generation are OpenAI-hosted (executed server-side) with no opencode.ai
  // equivalent, so they cannot be relayed to a chat model and are intentionally dropped.
```

So with `model_provider = opencodex` and a routed model (`anthropic/*`, `opencode-go/*`, `xai/*`),
`web_search = "live"` in Codex silently does nothing — the model can't search. Only native `gpt-*`
(forward/passthrough) gets real web search, because the ChatGPT backend runs it server-side.

## Goal

Give **non-OpenAI providers** a working web search by routing the actual search through
**`gpt-5.4-mini` in non-thinking mode** via the existing `forward` (ChatGPT passthrough) provider,
then injecting the results back into the main model's turn.

This is **Pattern B** from the cross-agent study (`14_web-search/00_web-search.md`) — "web search as a
separate model call" (how Claude Code does it) — with `gpt-5.4-mini` as the cheap, fast executor.

```
non-OpenAI model wants to search
        │  (opencodex exposes web_search as a callable function instead of dropping it)
        ▼
opencodex intercepts the web_search call  ──►  side-call: gpt-5.4-mini + {type:"web_search"}
        ▲                                        via forward → ChatGPT backend (server-side search)
        │  inject results + sources as tool_result      │
        └────────────────────────────────────────────────┘
        ▼
main model continues the turn with the search results
```

## Why gpt-5.4-mini, non-thinking

- It is a **native** gpt slug (routes to the `forward`/ChatGPT provider, which is the only path that
  has server-side `web_search`). Verified present in this Codex's catalog.
- **Non-thinking** (`reasoning.effort: "minimal"`/none): the sidecar is a *search executor*, not a
  reasoner — the main model does the reasoning. Minimal effort = lowest latency + cost per search.

## Non-goals (this plan)

- No implementation/code in this folder — **plan only** (`계획만`).
- Not replacing Codex's native web search for `gpt-*` (that already works via passthrough — the
  sidecar must be **skipped** when `adapter.passthrough` is true).
- Not building an independent search backend (Exa/Brave/etc.) — we reuse OpenAI's hosted search.

## Success criteria

- A routed model (`anthropic/claude-*` or `opencode-go/*`) under Codex `web_search = "live"` actually
  returns answers grounded in fresh web results, with sources.
- Native `gpt-*` behavior unchanged (no double-search, no regression).
- Opt-in / configurable; degrades gracefully when not logged into ChatGPT.

## Docs in this folder

- `01_codex-rs-wire-format.md` — exact request tool + response item JSON (grounded in codex-rs).
- `02_sidecar-architecture.md` — interception loop, side-call, auth reuse, result injection.
- `03_integration-and-roadmap.md` — files to touch, new module, risks, 5-phase roadmap.
