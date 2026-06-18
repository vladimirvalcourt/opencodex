# Sidecar architecture — gpt-5.4-mini web search executor

## The core idea

A non-OpenAI chat model can't run a server-side tool, but it CAN call a normal **function**. So:

1. **Expose** `web_search` to the chat model as a synthetic function tool (instead of dropping it).
2. **Intercept** the model's `web_search` function call inside the proxy — do NOT relay it to Codex.
3. **Execute** it by a side-call to `gpt-5.4-mini` through the `forward` (ChatGPT) provider, sending
   the REAL `{type:"web_search"}` hosted tool + `reasoning.effort:"minimal"`.
4. **Parse** the sidecar's answer + sources.
5. **Inject** the result back as a `tool_result` and re-call the main model so the turn continues.

This requires opencodex to run a small **agentic loop** around the main adapter call (today
`handleResponses` is single-shot).

## Flow (streaming turn)

```
Codex ──/v1/responses (model=anthropic/claude-…, tools:[…, {type:web_search}]) ──► opencodex
                                                                                      │
  parseRequest: stash hosted web_search config; expose synthetic fn "web_search"      │
                                                                                      ▼
                                 main adapter call #1 (Anthropic Messages, streamed)
                                                                                      │
                       model emits tool_call: web_search({query:"…"})  ◄──────────────┘
                                      │  INTERCEPT (don't forward to Codex)
                                      ▼
        sidecar: POST ChatGPT /responses  { model:"gpt-5.4-mini",
                                            input:[user: "<query>"],
                                            tools:[ stashed {type:"web_search", …} ],
                                            reasoning:{effort:"minimal"}, stream:false }
                                            headers: reuse caller's authorization + chatgpt-account-id
                                      │
                       parse output[]: answer text + web_search_call actions + url_citation sources
                                      ▼
        feed tool_result(web_search, id) back  ──►  main adapter call #2 (Anthropic, streamed)
                                                              │
        (optionally emit web_search_call items to Codex so the TUI shows the search)
                                                              ▼
                              final assistant text + citations ──► bridge ──► Codex SSE
```

## Auth — the critical detail

The `forward` adapter does NOT hold a key; it **relays the caller's headers**
(`src/adapters/openai-responses.ts`):

```
const FORWARD_HEADERS = ["authorization", "chatgpt-account-id", "openai-beta", "originator", "session_id"];
```

A proxy-**initiated** side-call has no incoming caller for those headers — so we must **snapshot** the
original request's `authorization` + `chatgpt-account-id` (the `IncomingMeta` already threaded into
`buildRequest`) at the top of `handleResponses`, and replay them on the sidecar fetch. If the caller
isn't logged into ChatGPT (no `authorization`), the sidecar is **disabled** for that turn and we
return a tool_result explaining search is unavailable (never crash the main turn).

## Non-thinking sidecar request

```jsonc
{
  "model": "gpt-5.4-mini",
  "instructions": "Search the web and answer the query concisely with sources.",
  "input": [{ "role": "user", "content": [{ "type": "input_text", "text": "<the query>" }]}],
  "tools": [ /* the stashed hosted web_search tool, verbatim */ ],
  "tool_choice": "auto",
  "reasoning": { "effort": "minimal" },
  "stream": false
}
```

- `reasoning.effort:"minimal"` ⇒ non-thinking, fastest/cheapest.
- The sidecar request carries ONLY the web_search tool — never the main turn's function tools (loop
  prevention: the sidecar cannot call back into opencodex).

## Result injection — what the main model sees

`format-result.ts` builds a compact, model-agnostic `tool_result` string, e.g.:

```
Web search results for "<query>":

<sidecar answer text>

Sources:
[1] <title> — <url>
[2] <title> — <url>
```

For Anthropic this becomes a `tool_result` content block; for openai-chat a `tool` role message —
both already supported by the adapters' `toolResult` handling.

## Streaming vs non-streaming

- **Sidecar**: non-streaming (`stream:false`) in Phase 1 — simplest to parse; latency acceptable for
  minimal-effort mini. Phase 2 may stream to forward `web_search_call` progress to the TUI.
- **Main turn**: stays streamed to Codex. While the sidecar runs, opencodex can emit a
  `web_search_call {status:"in_progress"}` then `{status:"completed"}` so the Codex TUI shows activity.

## Codex-facing parity

To make the Codex TUI render search like native, opencodex emits `web_search_call` output items
(§01) around the sidecar, and (Phase 4) passes `url_citation` annotations through on the final
`output_text`. Functionally the main model already has the answer; these are UX parity.
