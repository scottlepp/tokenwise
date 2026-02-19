import { describe, it, expect } from "vitest";
import { GET } from "./route";

describe("GET /v1/models", () => {
  it("returns a list of models in OpenAI format", async () => {
    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.object).toBe("list");
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
  });

  it("includes auto, opus, sonnet, and haiku models", async () => {
    const res = await GET();
    const body = await res.json();
    const ids = body.data.map((m: { id: string }) => m.id);

    expect(ids).toContain("auto");
    expect(ids).toContain("opus");
    expect(ids).toContain("sonnet");
    expect(ids).toContain("haiku");
  });

  it("each model has required OpenAI fields", async () => {
    const res = await GET();
    const body = await res.json();

    for (const model of body.data) {
      expect(model).toHaveProperty("id");
      expect(model).toHaveProperty("object", "model");
      expect(model).toHaveProperty("created");
      expect(model).toHaveProperty("owned_by");
      expect(typeof model.owned_by).toBe("string");
    }
  });
});
