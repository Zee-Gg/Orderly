import { describe, expect, it, vi } from "vitest";
import { MEDIA_MAX_BYTES } from "./config";
import { createMemoryStore } from "./memory-store";
import type { FetchLike } from "./graph";
import { baseMimeType, mediaPath, storeInboundMedia } from "./media";

const account = { id: "acc-1", restaurantId: "rest-1", branchId: null, phoneNumberId: "111", isActive: true, accessTokenEncrypted: "enc" };

async function setup() {
  const mem = createMemoryStore({ accounts: [account] });
  const r = await mem.store.recordInbound(
    "rest-1",
    {
      phoneNumberId: "111", waId: "923001234567", profileName: null, waMessageId: "wamid.img", type: "image", body: null,
      mediaId: "MEDIA1", sentAt: new Date().toISOString(), raw: {},
    },
    "+923001234567",
  );
  return { mem, messageId: r.messageId };
}

function graph(info: Record<string, unknown>, bytes: Uint8Array, headers: Record<string, string> = {}) {
  return vi.fn<FetchLike>(async (url) =>
    url.includes("/MEDIA1")
      ? new Response(JSON.stringify(info), { status: 200 })
      : new Response(bytes as Uint8Array<ArrayBuffer>, { status: 200, headers: { "content-type": "image/jpeg", ...headers } }),
  );
}

describe("storeInboundMedia", () => {
  it("downloads the file, stores it under {restaurant_id}/ and links it to the message", async () => {
    const { mem, messageId } = await setup();
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
    const fetch = graph({ url: "https://lookaside.example/abc", mime_type: "image/jpeg", file_size: 6 }, bytes);
    const res = await storeInboundMedia({ store: mem.store, fetch, decrypt: () => "token" }, account, messageId, "MEDIA1");
    expect(res).toMatchObject({ ok: true, path: `rest-1/${messageId}.jpg`, mimeType: "image/jpeg", size: 6 });
    expect(mem.files.get(`rest-1/${messageId}.jpg`)?.bytes).toEqual(bytes);
    expect(mem.messages.find((m) => m.id === messageId)).toMatchObject({ mediaUrl: `rest-1/${messageId}.jpg`, mediaMimeType: "image/jpeg" });
    // Both calls carry the token (Meta media URLs need it too).
    for (const [, init] of fetch.mock.calls) {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer token");
    }
  });

  it("skips files over 16 MB and saves the error on the message", async () => {
    const { mem, messageId } = await setup();
    const fetch = graph({ url: "https://lookaside.example/big", mime_type: "video/mp4", file_size: MEDIA_MAX_BYTES + 1 }, new Uint8Array(1));
    const res = await storeInboundMedia({ store: mem.store, fetch, decrypt: () => "token" }, account, messageId, "MEDIA1");
    expect(res).toMatchObject({ ok: false, error: expect.stringContaining("bigger than 16 MB") });
    expect(fetch).toHaveBeenCalledTimes(1); // never downloaded
    expect(mem.files.size).toBe(0);
    expect(mem.messages.find((m) => m.id === messageId)?.error).toContain("16 MB");
  });

  it("also stops when the download itself is too big (size not declared)", async () => {
    const { mem, messageId } = await setup();
    const fetch = graph(
      { url: "https://lookaside.example/x", mime_type: "audio/ogg" },
      new Uint8Array(10),
      { "content-length": String(MEDIA_MAX_BYTES + 5) },
    );
    expect(await storeInboundMedia({ store: mem.store, fetch, decrypt: () => "token" }, account, messageId, "MEDIA1")).toMatchObject({
      ok: false,
    });
    expect(mem.files.size).toBe(0);
  });

  it("saves the Meta error (without the token) when the media id is bad", async () => {
    const { mem, messageId } = await setup();
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ error: { code: 100, message: "Invalid media id, token EAAGsecret12345678" } }), { status: 400 }),
    );
    const res = await storeInboundMedia({ store: mem.store, fetch, decrypt: () => "EAAGsecret12345678" }, account, messageId, "MEDIA1");
    expect(res.ok).toBe(false);
    expect(JSON.stringify(mem.messages)).not.toContain("EAAGsecret12345678");
  });

  it("names files by type", () => {
    expect(baseMimeType("audio/ogg; codecs=opus")).toBe("audio/ogg");
    expect(mediaPath("r", "m", "audio/ogg; codecs=opus")).toBe("r/m.ogg");
    expect(mediaPath("r", "m", "application/pdf")).toBe("r/m.pdf");
    expect(mediaPath("r", "m", "weird/type")).toBe("r/m.bin");
  });
});
