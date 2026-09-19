import assert from "node:assert/strict";
import test from "node:test";
import WebPPastePlugin from "../src/main.ts";
import {
  noticeEvents,
  resetNoticeEvents,
  resetRequestUrlImplementation,
  setRequestUrlImplementation,
} from "./obsidian-test-stub.ts";

const SOURCE = "https://example.com/articles/hello";

interface RuntimePlugin {
  downloadLoupeImage(resolvedUrl: string): Promise<ArrayBuffer | null>;
  localizeLoupeImages(
    note: { basename: string },
    markdown: string,
    sourceUrl: string,
  ): Promise<void>;
}

function createRuntimePlugin(): RuntimePlugin {
  const app = {
    vault: {
      getFolderByPath: () => ({}),
      getAbstractFileByPath: () => null,
      createBinary: async (path: string) => ({ path }),
      process: async (_note: unknown, callback: (current: string) => string) => {
        callback("");
      },
    },
  };
  return new WebPPastePlugin(app as never, undefined as never) as unknown as RuntimePlugin;
}

function progressMessages(): string[] {
  return noticeEvents
    .filter((event) => event.kind === "created" || event.kind === "updated")
    .map((event) => event.message);
}

test.afterEach(() => {
  resetNoticeEvents();
  resetRequestUrlImplementation();
});

test("Loupe image localization reports progress while using every target concurrently", async () => {
  const imageUrls = [
    "https://example.com/one.jpg",
    "https://example.com/two.jpg",
    "https://example.com/three.jpg",
  ];
  const releases = new Map<string, () => void>();
  let active = 0;
  let maximumActive = 0;
  const plugin = createRuntimePlugin();
  plugin.downloadLoupeImage = async (resolvedUrl) => {
    active++;
    maximumActive = Math.max(maximumActive, active);
    return await new Promise<ArrayBuffer>((resolve) => {
      releases.set(resolvedUrl, () => {
        active--;
        resolve(new ArrayBuffer(1));
      });
    });
  };

  const markdown = imageUrls.map((url) => `![](${url})`).join("\n");
  const localization = plugin.localizeLoupeImages({ basename: "Imported note" }, markdown, SOURCE);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  assert.equal(maximumActive, imageUrls.length);
  assert.equal(releases.size, imageUrls.length);
  for (const url of [imageUrls[2], imageUrls[0], imageUrls[1]]) {
    releases.get(url!)!();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  await localization;

  assert.deepEqual(progressMessages(), [
    "Loupe: importing images (0/3)…",
    "Loupe: importing images (1/3)…",
    "Loupe: importing images (2/3)…",
    "Loupe: importing images (3/3)…",
  ]);
  assert.deepEqual(noticeEvents.at(-1), { kind: "hidden" });
});

test("Loupe image localization advances progress for failed images", async () => {
  const plugin = createRuntimePlugin();
  plugin.downloadLoupeImage = async (resolvedUrl) =>
    resolvedUrl.endsWith("failed.jpg") ? null : new ArrayBuffer(1);

  await plugin.localizeLoupeImages(
    { basename: "Imported note" },
    "![](https://example.com/ok.jpg)\n![](https://example.com/failed.jpg)",
    SOURCE,
  );

  assert.deepEqual(progressMessages(), [
    "Loupe: importing images (0/2)…",
    "Loupe: importing images (1/2)…",
    "Loupe: importing images (2/2)…",
    "Loupe: localized 1 of 2 images; 1 remain external.",
  ]);
  assert.deepEqual(noticeEvents.at(-2), { kind: "hidden" });
});

test("Loupe image requests retry transient failures with browser-like headers", async () => {
  const requests: unknown[] = [];
  let attempts = 0;
  const webpBytes = new Uint8Array([
    0x52,
    0x49,
    0x46,
    0x46,
    1,
    2,
    3,
    4,
    0x57,
    0x45,
    0x42,
    0x50,
  ]).buffer;
  const globalObject = globalThis as Record<string, unknown>;
  const originalCreateImageBitmap = globalObject["createImageBitmap"];
  globalObject["createImageBitmap"] = async () => ({
    width: 1,
    height: 1,
    close(): void {},
  });
  setRequestUrlImplementation(async (request) => {
    requests.push(request);
    attempts++;
    if (attempts < 3) {
      return {
        status: 503,
        headers: {},
        arrayBuffer: new ArrayBuffer(0),
      };
    }
    return {
      status: 200,
      headers: { "content-type": "image/webp" },
      arrayBuffer: webpBytes,
    };
  });

  try {
    const data = await createRuntimePlugin().downloadLoupeImage("https://example.com/photo.jpg");
    assert.deepEqual(data, webpBytes);
    const expectedRequest = {
      url: "https://example.com/photo.jpg",
      method: "GET",
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
      },
      throw: false,
    };
    assert.deepEqual(requests, [expectedRequest, expectedRequest, expectedRequest]);
  } finally {
    if (originalCreateImageBitmap === undefined) {
      delete globalObject["createImageBitmap"];
    } else {
      globalObject["createImageBitmap"] = originalCreateImageBitmap;
    }
  }
});
