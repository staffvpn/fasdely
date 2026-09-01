import { describe, it, expect, vi, beforeEach } from "vitest";
import { getMenu, createOrder } from "./api.ts";

vi.mock("./telegram.ts", () => ({ getInitData: () => "mock-init-data" }));

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

describe("getMenu", () => {
  it("returns ok with the parsed response on success", async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ location: { id: "loc-1", name: "Test" }, categories: [], products: [] }),
    });
    const result = await getMenu("qr-abc");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.location.id).toBe("loc-1");
    expect((fetch as any).mock.calls[0][0]).toContain("qr_token=qr-abc");
  });

  it("returns ok:false with the server's error reason on failure", async () => {
    (fetch as any).mockResolvedValue({ ok: false, json: async () => ({ error: "location_not_found" }) });
    const result = await getMenu("bad-token");
    expect(result).toEqual({ ok: false, error: "location_not_found" });
  });
});

describe("createOrder", () => {
  it("sends init_data from the telegram wrapper automatically", async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: async () => ({ order: { id: "o1" } }) });
    await createOrder({
      locationId: "loc-1",
      orderType: "dine_in",
      requestedTimeMode: "asap",
      idempotencyKey: "key-1",
      items: [],
    });
    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.init_data).toBe("mock-init-data");
    expect(body.location_id).toBe("loc-1");
  });
});
