import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { clearCache, clearDedup } from "@/lib/cache";
import { db } from "@/lib/db";
import { taskLogs } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

let testCounter = 0;
function uniqueMessage(base: string = "What is 2+2?") {
  return `${base} (test-${++testCounter}-${Date.now()})`;
}

describe("POST /v1/chat/completions", () => {
  beforeEach(() => {
    clearCache();
  });

  describe("request validation", () => {
    it("rejects invalid JSON", async () => {
      const req = new NextRequest("http://localhost:3000/v1/chat/completions", {
        method: "POST",
        body: "not json",
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("invalid_json");
    });

    it("rejects missing messages", async () => {
      const res = await POST(makeRequest({ model: "auto" }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("invalid_messages");
    });

    it("rejects empty messages array", async () => {
      const res = await POST(makeRequest({ model: "auto", messages: [] }));
      expect(res.status).toBe(400);
    });
  });

  describe("non-streaming completions", () => {
    it("returns an OpenAI-format response", async () => {
      const res = await POST(
        makeRequest({
          model: "haiku",
          messages: [{ role: "user", content: uniqueMessage("What is 2+2?") }],
        })
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.object).toBe("chat.completion");
      expect(body.choices).toHaveLength(1);
      expect(body.choices[0].message.role).toBe("assistant");
      expect(body.choices[0].message.content).toBeTruthy();
      expect(body.choices[0].finish_reason).toBe("stop");
      expect(body.usage).toBeDefined();
      expect(body.usage.prompt_tokens).toBeGreaterThan(0);
      expect(body.usage.completion_tokens).toBeGreaterThan(0);
      expect(body.id).toMatch(/^chatcmpl-/);
    }, 30_000);

    it("includes x-model header", async () => {
      const res = await POST(
        makeRequest({
          model: "haiku",
          messages: [{ role: "user", content: uniqueMessage("Say hi") }],
        })
      );
      expect(res.headers.get("x-model")).toBe("haiku");
    }, 30_000);

    it("logs task to database", async () => {
      const msg = uniqueMessage("What is the capital of France?");
      await POST(
        makeRequest({
          model: "haiku",
          messages: [{ role: "user", content: msg }],
        })
      );

      // Check DB for the logged task
      const [row] = await db
        .select()
        .from(taskLogs)
        .orderBy(desc(taskLogs.createdAt))
        .limit(1);

      expect(row).toBeDefined();
      expect(row.modelSelected).toBe("claude-haiku-4-5-20251001");
      expect(row.streaming).toBe(false);
      expect(row.cliSuccess).toBe(true);
      expect(row.promptSummary).toContain("capital of France");
    }, 30_000);
  });

  describe("streaming completions", () => {
    it("returns text/event-stream with SSE chunks ending in [DONE]", async () => {
      const res = await POST(
        makeRequest({
          model: "haiku",
          messages: [{ role: "user", content: uniqueMessage("Say hello") }],
          stream: true,
        })
      );
      expect(res.headers.get("Content-Type")).toBe("text/event-stream");

      const text = await res.text();
      expect(text).toContain("data: ");
      expect(text).toContain("data: [DONE]");

      const dataLines = text
        .split("\n")
        .filter((l) => l.startsWith("data: ") && l !== "data: [DONE]");
      expect(dataLines.length).toBeGreaterThan(0);

      const firstChunk = JSON.parse(dataLines[0].replace("data: ", ""));
      expect(firstChunk.object).toBe("chat.completion.chunk");
    }, 30_000);

    it("includes x-task-id header", async () => {
      const res = await POST(
        makeRequest({
          model: "haiku",
          messages: [{ role: "user", content: uniqueMessage("Hi") }],
          stream: true,
        })
      );
      expect(res.headers.get("x-task-id")).toBeTruthy();
    }, 30_000);
  });

  describe("/feedback command interception", () => {
    it("intercepts /feedback good and returns synthetic response without calling CLI", async () => {
      // First create a task so there's something to rate
      await POST(
        makeRequest({
          model: "haiku",
          messages: [{ role: "user", content: uniqueMessage("What is 1+1?") }],
        })
      );

      const res = await POST(
        makeRequest({
          model: "auto",
          messages: [{ role: "user", content: "/feedback good" }],
        })
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.choices[0].message.content).toContain("Feedback recorded");
      expect(body.choices[0].message.content).toContain("positive");
    }, 30_000);

    it("intercepts /feedback bad and rates as negative", async () => {
      const res = await POST(
        makeRequest({
          model: "auto",
          messages: [{ role: "user", content: "/feedback bad" }],
        })
      );
      const body = await res.json();
      expect(body.choices[0].message.content).toContain("negative");
    }, 30_000);

    it("does NOT intercept normal messages containing 'feedback'", async () => {
      const res = await POST(
        makeRequest({
          model: "haiku",
          messages: [{ role: "user", content: uniqueMessage("How do I give feedback to my team?") }],
        })
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      // Should be a real Claude response, not a synthetic feedback confirmation
      expect(body.choices[0].message.content).not.toContain("Feedback recorded");
    }, 30_000);
  });

  describe("cache", () => {
    it("returns cached response for identical non-streaming request", async () => {
      const msg = uniqueMessage("What is 3+3?");
      const req = {
        model: "haiku",
        messages: [{ role: "user", content: msg }],
      };

      const res1 = await POST(makeRequest(req));
      expect(res1.status).toBe(200);
      expect(res1.headers.get("x-cache-hit")).toBe("false");
      const body1 = await res1.json();

      // Clear dedup window so second request isn't rejected as duplicate
      clearDedup();

      const res2 = await POST(makeRequest(req));
      expect(res2.status).toBe(200);
      expect(res2.headers.get("x-cache-hit")).toBe("true");
      const body2 = await res2.json();

      // Same content from cache
      expect(body2.choices[0].message.content).toBe(body1.choices[0].message.content);
    }, 30_000);
  });

  describe("model routing", () => {
    it("routes 'auto' to a model based on complexity", async () => {
      const res = await POST(
        makeRequest({
          model: "auto",
          messages: [{ role: "user", content: uniqueMessage("What is 2+2?") }],
        })
      );
      expect(res.status).toBe(200);
      // Simple question should route to haiku
      expect(res.headers.get("x-model")).toBe("haiku");
    }, 30_000);

    it("respects explicit model selection", async () => {
      const res = await POST(
        makeRequest({
          model: "sonnet",
          messages: [{ role: "user", content: uniqueMessage("Say hi") }],
        })
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("x-model")).toBe("sonnet");
    }, 30_000);
  });
});
