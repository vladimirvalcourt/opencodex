import { describe, expect, test } from "bun:test";
import { buildProviderTableBlock } from "../src/codex-inject";

describe("Codex config injection", () => {
  test("advertises provider-level Responses WebSocket support by default", () => {
    const block = buildProviderTableBlock(10100);

    expect(block).toContain("[model_providers.opencodex]");
    expect(block).toContain('wire_api = "responses"');
    expect(block).toContain("requires_openai_auth = true");
    expect(block).toContain("supports_websockets = true");
  });

  test("can omit provider-level Responses WebSocket support for explicit opt-out", () => {
    const block = buildProviderTableBlock(10100, false);

    expect(block).not.toContain("supports_websockets");
  });
});
