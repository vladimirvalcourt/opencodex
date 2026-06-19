# 100.11 — Search Defaults and Inherited State

## Question

What do native Codex default models actually use for `web_search_tool_type`, and what are routed
opencodex models currently inheriting?

## Native Codex Defaults

Concrete native catalog values live in:

```text
/tmp/opencodex-codex-src/codex-rs/models-manager/models.json
```

That file is bundled by:

```text
/tmp/opencodex-codex-src/codex-rs/models-manager/src/lib.rs:12
```

Observed native rows:

| Model | `web_search_tool_type` | `supports_search_tool` | Notes |
| --- | --- | --- | --- |
| `gpt-5.5` | `text_and_image` | `true` | priority 0, picker-visible, current native default |
| `gpt-5.4` | `text_and_image` | `true` | picker-visible |
| `gpt-5.4-mini` | `text_and_image` | `true` | picker-visible/helper |
| `gpt-5.3-codex` | `text` | `true` | picker-visible |
| `gpt-5.2` | `text` | `true` | picker-visible |
| `codex-auto-review` | `text_and_image` | `true` | hidden helper |

Codex chooses the default model by sorting available models by `priority`, then picking the first
picker-visible model. With the inspected catalog, that makes `gpt-5.5` the native default, and its
native hosted web-search shape is `text_and_image`.

Relevant upstream paths:

```text
/tmp/opencodex-codex-src/codex-rs/models-manager/src/manager.rs:117
/tmp/opencodex-codex-src/codex-rs/models-manager/src/manager.rs:145
/tmp/opencodex-codex-src/codex-rs/protocol/src/openai_models.rs:625
```

## Missing-Field Fallbacks

If a model row omits these fields:

- `web_search_tool_type` falls back to `text`.
- `supports_search_tool` falls back to `false`.

Unknown model fallback metadata also sets:

```text
web_search_tool_type = Text
supports_search_tool = false
```

Relevant upstream paths:

```text
/tmp/opencodex-codex-src/codex-rs/protocol/src/openai_models.rs:279
/tmp/opencodex-codex-src/codex-rs/protocol/src/openai_models.rs:376
/tmp/opencodex-codex-src/codex-rs/protocol/src/openai_models.rs:408
/tmp/opencodex-codex-src/codex-rs/protocol/src/openai_models.rs:909
/tmp/opencodex-codex-src/codex-rs/models-manager/src/model_info.rs:65
/tmp/opencodex-codex-src/codex-rs/models-manager/src/model_info.rs:90
/tmp/opencodex-codex-src/codex-rs/models-manager/src/model_info.rs:102
```

Runtime interpretation:

- `text` emits no `search_content_types`.
- `text_and_image` emits `search_content_types: ["text", "image"]`.
- `supports_search_tool` is separate and gates deferred `tool_search`.

Relevant upstream paths:

```text
/tmp/opencodex-codex-src/codex-rs/core/src/tools/spec_plan.rs:312
/tmp/opencodex-codex-src/codex-rs/core/src/tools/spec_plan.rs:328
/tmp/opencodex-codex-src/codex-rs/core/src/tools/hosted_spec.rs:28
/tmp/opencodex-codex-src/codex-rs/core/src/tools/hosted_spec_tests.rs:20
/tmp/opencodex-codex-src/codex-rs/core/src/tools/spec_plan_tests.rs:700
```

## Current opencodex Catalog Observation

The live local opencodex catalog currently shows routed entries inheriting native search metadata.

Observed from:

```text
/Users/jun/.codex/opencodex-catalog.json
```

Representative entries:

| Slug | `web_search_tool_type` | `supports_search_tool` |
| --- | --- | --- |
| `gpt-5.5` | `text_and_image` | `true` |
| `gpt-5.3-codex-spark` | `text` | `true` |
| `opencode-go/kimi-k2.7-code` | `text_and_image` | `true` |
| `opencode-go/glm-5.2` | `text_and_image` | `true` |
| `opencode-go/deepseek-v4-pro` | `text_and_image` | `true` |

This is not because opencode-go models have native OpenAI hosted image-search support. It is because
opencodex cloned a native template and did not normalize these fields.

Local source:

```text
/Users/jun/Developer/new/700_projects/opencodex/src/codex-catalog.ts:108
```

## Decision

Leave the current behavior documented for now, but treat it as explicit technical debt:

- native OpenAI passthrough may keep `text_and_image` and `supports_search_tool`;
- routed non-OpenAI models should not inherit hosted OpenAI search semantics silently;
- if opencodex keeps `web_search_tool_type = text_and_image`, the docs must state it means Codex
  will offer a hosted text+image web-search shape, while opencodex currently converts/drops hosted
  tools and can only provide sidecar synthetic web-search behavior;
- first implementation pass should prefer setting routed `web_search_tool_type` to `text` unless
  the sidecar actually supports image-search semantics end to end.

## Implementation Note

`supports_search_tool` should not be used as a web-search flag. It is for deferred tool discovery.
It can remain enabled for routed models only if opencodex wants routed providers to see Codex's
deferred tool-discovery surface.
