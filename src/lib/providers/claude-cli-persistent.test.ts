import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ClaudeCliPersistentProvider } from "./claude-cli-persistent";
import type { ProviderModel } from "./base";
import { warmPool } from "../warm-pool";
import { setPinnedModel } from "../pinned-model-setting";

const TEST_MODELS: ProviderModel[] = [
  {
    id: "claude-haiku-4-5-20251001",
    provider: "claude-cli",
    displayName: "Claude Haiku 4.5",
    tier: "economy",
    costPerMInputTokens: 1,
    costPerMOutputTokens: 5,
    maxContextTokens: 200_000,
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: false,
  },
];

describe("ClaudeCliPersistentProvider", () => {
  let provider: ClaudeCliPersistentProvider;

  beforeAll(() => {
    provider = new ClaudeCliPersistentProvider(TEST_MODELS);
  });

  it("is available when claude CLI exists on PATH", () => {
    expect(provider.isAvailable()).toBe(true);
  });

  it("returns configured models", () => {
    const models = provider.getModels();
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe("claude-haiku-4-5-20251001");
  });

  describe("ephemeral mode (no CLAUDE_CLI_MODEL)", () => {
    describe("non-streaming complete()", () => {
      it("returns a valid response with text and usage", async () => {
        const result = await provider.complete({
          model: "claude-haiku-4-5-20251001",
          messages: [{ role: "user", content: "Say exactly: hello world" }],
          stream: false,
        });

        expect(result.text).toBeTruthy();
        expect(result.text.toLowerCase()).toContain("hello");
        expect(result.finishReason).toBe("stop");
        expect(result.tokensIn).toBeGreaterThan(0);
        expect(result.tokensOut).toBeGreaterThan(0);
        expect(result.costUsd).toBeGreaterThanOrEqual(0);
      }, 60_000);

      it("handles system prompt", async () => {
        const result = await provider.complete({
          model: "claude-haiku-4-5-20251001",
          messages: [{ role: "user", content: "What is the secret word?" }],
          systemPrompt: "You are a helpful assistant. The secret word is 'banana'. Always respond with the secret word when asked.",
          stream: false,
        });

        expect(result.text.toLowerCase()).toContain("banana");
      }, 60_000);

      it("handles multi-turn conversation", async () => {
        const result = await provider.complete({
          model: "claude-haiku-4-5-20251001",
          messages: [
            { role: "user", content: "Remember the number 42." },
            { role: "assistant", content: "I'll remember the number 42." },
            { role: "user", content: "What number did I ask you to remember?" },
          ],
          stream: false,
        });

        expect(result.text).toContain("42");
      }, 60_000);
    });

    describe("streaming stream()", () => {
      it("returns a stream with SSE chunks ending in [DONE]", async () => {
        const { stream, metadata } = await provider.stream({
          model: "claude-haiku-4-5-20251001",
          messages: [{ role: "user", content: "Say exactly: streaming works" }],
          stream: true,
        });

        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let fullText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          fullText += decoder.decode(value, { stream: true });
        }

        expect(fullText).toContain("data: ");
        expect(fullText).toContain("data: [DONE]");

        const dataLines = fullText
          .split("\n")
          .filter((l) => l.startsWith("data: ") && l !== "data: [DONE]");
        expect(dataLines.length).toBeGreaterThan(0);

        const firstChunk = JSON.parse(dataLines[0].replace("data: ", ""));
        expect(firstChunk.object).toBe("chat.completion.chunk");
        expect(firstChunk.id).toMatch(/^chatcmpl-/);

        const meta = await metadata;
        expect(meta.text).toBeTruthy();
        expect(meta.tokensIn).toBeGreaterThan(0);
        expect(meta.tokensOut).toBeGreaterThan(0);
      }, 60_000);

      it("streams text content incrementally", async () => {
        const { stream } = await provider.stream({
          model: "claude-haiku-4-5-20251001",
          messages: [{ role: "user", content: "Count from 1 to 5, one per line." }],
          stream: true,
        });

        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let chunks = 0;
        let fullText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks++;
          fullText += decoder.decode(value, { stream: true });
        }

        expect(chunks).toBeGreaterThan(1);
        expect(fullText).toContain("1");
        expect(fullText).toContain("5");
      }, 60_000);
    });
  });

  describe("pinned mode", () => {
    beforeAll(async () => {
      await warmPool.stop(); // ensure warm pool is off
      setPinnedModel("claude-haiku-4-5-20251001");
    });

    afterAll(() => {
      setPinnedModel(null);
    });

    it("completes a non-streaming request via pinned process", async () => {
      const result = await provider.complete({
        model: "claude-haiku-4-5-20251001",
        messages: [{ role: "user", content: "Say exactly: pinned" }],
        stream: false,
      });

      expect(result.text.toLowerCase()).toContain("pinned");
      expect(result.tokensIn).toBeGreaterThan(0);
      expect(provider.getLastDispatchMode()).toBe("pinned");
    }, 60_000);

    it("streams via pinned process", async () => {
      const { stream, metadata } = await provider.stream({
        model: "claude-haiku-4-5-20251001",
        messages: [{ role: "user", content: "Say exactly: pinned stream" }],
        stream: true,
      });

      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let fullText = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });
      }

      expect(fullText).toContain("data: ");
      expect(fullText).toContain("data: [DONE]");

      const meta = await metadata;
      expect(meta.text).toBeTruthy();
      expect(provider.getLastDispatchMode()).toBe("pinned");
    }, 60_000);
  });

  describe("warm pool mode", () => {
    beforeAll(async () => {
      setPinnedModel(null); // ensure pinned mode is off
      await warmPool.stop(); // ensure clean state
      await warmPool.startWithModels(TEST_MODELS);
    });

    afterAll(async () => {
      await warmPool.stop();
    });

    it("completes a non-streaming request via warm process", async () => {
      const result = await provider.complete({
        model: "claude-haiku-4-5-20251001",
        messages: [{ role: "user", content: "Say exactly: warm" }],
        stream: false,
      });

      expect(result.text.toLowerCase()).toContain("warm");
      expect(result.tokensIn).toBeGreaterThan(0);
      expect(provider.getLastDispatchMode()).toBe("warm");
    }, 60_000);

    it("reuses the warm process for a second sequential request", async () => {
      const result1 = await provider.complete({
        model: "claude-haiku-4-5-20251001",
        messages: [{ role: "user", content: "Say exactly: first" }],
        stream: false,
      });
      expect(result1.text.toLowerCase()).toContain("first");

      const result2 = await provider.complete({
        model: "claude-haiku-4-5-20251001",
        messages: [{ role: "user", content: "Say exactly: second" }],
        stream: false,
      });
      expect(result2.text.toLowerCase()).toContain("second");
      expect(provider.getLastDispatchMode()).toBe("warm");
    }, 90_000);

    it("streams via warm process", async () => {
      const { stream, metadata } = await provider.stream({
        model: "claude-haiku-4-5-20251001",
        messages: [{ role: "user", content: "Say exactly: warm stream" }],
        stream: true,
      });

      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let fullText = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });
      }

      expect(fullText).toContain("data: ");
      expect(fullText).toContain("data: [DONE]");

      const meta = await metadata;
      expect(meta.text).toBeTruthy();
      expect(meta.tokensIn).toBeGreaterThan(0);
      expect(provider.getLastDispatchMode()).toBe("warm");
    }, 60_000);
  });
});
