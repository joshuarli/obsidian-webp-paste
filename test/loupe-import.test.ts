import assert from "node:assert/strict";
import test from "node:test";
import {
  applyLoupeImageLocalizations,
  buildLoupeImagePath,
  buildLoupeNotePath,
  collectLoupeRemoteImages,
  findLoupeImageOccurrences,
  firstAvailablePath,
  isWebPBytes,
  loupeImageTimestamp,
  mapWithConcurrency,
  parseLoupeImportParams,
  readResponseContentType,
  resolveLoupeImageUrl,
  sanitizeLoupeBasename,
  sha256Hex,
  verifyLoupeClipboard,
} from "../src/loupe-import.ts";

const SOURCE = "https://example.com/articles/hello";

test("detects a standard inline image embed", () => {
  const occurrences = findLoupeImageOccurrences("See ![photo](https://example.com/a.jpg) here.");

  assert.equal(occurrences.length, 1);
  assert.equal(occurrences[0]?.alt, "photo");
  assert.equal(occurrences[0]?.destination, "https://example.com/a.jpg");
});

test("does not mistake ordinary links for images", () => {
  assert.equal(findLoupeImageOccurrences("[text](https://example.com/a.jpg)").length, 0);
  assert.equal(findLoupeImageOccurrences("!![x](https://example.com/a.jpg)").length, 1);
});

test("does not treat escaped image syntax as an image", () => {
  assert.equal(findLoupeImageOccurrences("\\![x](https://example.com/a.jpg)").length, 0);
  assert.equal(findLoupeImageOccurrences("\\\\![x](https://example.com/a.jpg)").length, 1);
});

test("ignores wikilink embeds", () => {
  assert.equal(findLoupeImageOccurrences("See ![[foo.webp]] here.").length, 0);
});

test("tolerates an empty alt string", () => {
  const occurrences = findLoupeImageOccurrences("![](https://example.com/a.jpg)");

  assert.equal(occurrences.length, 1);
  assert.equal(occurrences[0]?.alt, "");
});

test("supports angle-bracket destinations and optional titles", () => {
  const occurrences = findLoupeImageOccurrences(
    '![a](<https://example.com/a b.jpg> "A title") and ![b](https://example.com/c.jpg \'t\')',
  );

  assert.equal(occurrences.length, 2);
  assert.equal(occurrences[0]?.destination, "https://example.com/a b.jpg");
  assert.equal(occurrences[1]?.destination, "https://example.com/c.jpg");
});

test("does not truncate URLs containing parentheses", () => {
  const occurrences = findLoupeImageOccurrences(
    "![a](https://example.com/img_(1).jpg) ![b](https://example.com/a\\(b\\).jpg)",
  );

  assert.equal(occurrences.length, 2);
  assert.equal(occurrences[0]?.destination, "https://example.com/img_(1).jpg");
  assert.equal(
    resolveLoupeImageUrl(occurrences[1]?.destination ?? "", SOURCE),
    "https://example.com/a(b).jpg",
  );
});

test("ignores image syntax inside fenced code", () => {
  const markdown = [
    "```markdown",
    "![code](https://example.com/code.jpg)",
    "```",
    "",
    "~~~",
    "![tilde](https://example.com/tilde.jpg)",
    "~~~",
    "",
    "![real](https://example.com/real.jpg)",
  ].join("\n");

  assert.deepEqual(
    findLoupeImageOccurrences(markdown).map((occurrence) => occurrence.destination),
    ["https://example.com/real.jpg"],
  );
});

test("ignores image syntax inside inline code", () => {
  const occurrences = findLoupeImageOccurrences(
    "`![code](https://example.com/code.jpg)` and ``![more](https://example.com/m.jpg)``",
  );

  assert.equal(occurrences.length, 0);
});

test("resolves relative destinations against the source page", () => {
  assert.equal(
    resolveLoupeImageUrl("/images/a.jpg", SOURCE),
    "https://example.com/images/a.jpg",
  );
  assert.equal(
    resolveLoupeImageUrl("../up.jpg", "https://example.com/articles/2024/hello"),
    "https://example.com/articles/up.jpg",
  );
});

test("resolves protocol-relative destinations", () => {
  assert.equal(
    resolveLoupeImageUrl("//cdn.example.com/a.jpg", SOURCE),
    "https://cdn.example.com/a.jpg",
  );
});

test("leaves non-web destinations alone", () => {
  for (const destination of [
    "",
    "#fragment",
    "data:image/png;base64,AAAA",
    "file:///tmp/a.jpg",
    "javascript:alert(1)",
    "obsidian://open?vault=x",
  ]) {
    assert.equal(resolveLoupeImageUrl(destination, SOURCE), null, destination);
  }
});

test("deduplicates identical resolved URLs within one article", () => {
  const images = collectLoupeRemoteImages(
    "![a](/a.jpg)\n\n![b](https://example.com/a.jpg)\n\n![c](/a.jpg)",
    SOURCE,
  );

  assert.deepEqual(images.map((image) => image.resolvedUrl), ["https://example.com/a.jpg"]);
});

test("rewrite preserves unrelated bytes and leaves unmapped URLs external", () => {
  const markdown = "# Title\n\n![ok](https://example.com/ok.jpg)\n\n![bad](https://example.com/bad.jpg)\n";
  const rewritten = applyLoupeImageLocalizations(
    markdown,
    SOURCE,
    new Map([["https://example.com/ok.jpg", "![[z-images/Note 20260919123456-01.webp]]"]]),
  );

  assert.equal(
    rewritten,
    "# Title\n\n![[z-images/Note 20260919123456-01.webp]]\n\n![bad](https://example.com/bad.jpg)\n",
  );
});

test("rewrite applies to current note contents so concurrent edits survive", () => {
  const edited = "# Title\n\nUser added this line.\n\n![ok](https://example.com/ok.jpg)\n";
  const rewritten = applyLoupeImageLocalizations(
    edited,
    SOURCE,
    new Map([["https://example.com/ok.jpg", "![[z-images/Note 20260919123456-01.webp]]"]]),
  );

  assert.ok(rewritten.includes("User added this line."));
  assert.ok(rewritten.includes("![[z-images/Note 20260919123456-01.webp]]"));
  assert.ok(!rewritten.includes("https://example.com/ok.jpg"));
});

test("rewrite points duplicate embeds at one local asset", () => {
  const markdown = "![a](/a.jpg) text ![b](https://example.com/a.jpg)";
  const rewritten = applyLoupeImageLocalizations(
    markdown,
    SOURCE,
    new Map([["https://example.com/a.jpg", "![[z-images/Note 20260919123456-01.webp]]"]]),
  );

  assert.equal(
    rewritten,
    "![[z-images/Note 20260919123456-01.webp]] text ![[z-images/Note 20260919123456-01.webp]]",
  );
});

test("rewrite preserves supported syntax and non-web or local embeds", () => {
  const markdown = [
    '![angle](<https://example.com/a b.jpg> "title")',
    "![escaped](https://example.com/b\\(1\\).jpg)",
    "![[z-images/existing.webp]]",
    "![file](file:///tmp/existing.jpg)",
    "`![code](https://example.com/code.jpg)`",
  ].join("\n");
  const rewritten = applyLoupeImageLocalizations(
    markdown,
    SOURCE,
    new Map([
      ["https://example.com/a%20b.jpg", "![[z-images/Note-01.webp]]"],
      ["https://example.com/b(1).jpg", "![[z-images/Note-02.webp]]"],
    ]),
  );

  assert.equal(
    rewritten,
    [
      "![[z-images/Note-01.webp]]",
      "![[z-images/Note-02.webp]]",
      "![[z-images/existing.webp]]",
      "![file](file:///tmp/existing.jpg)",
      "`![code](https://example.com/code.jpg)`",
    ].join("\n"),
  );
});

test("verifies clipboard text against the expected hash", async () => {
  const sha256 = await sha256Hex("article text");

  assert.equal(await verifyLoupeClipboard("article text", sha256), true);
  assert.equal(await verifyLoupeClipboard("different text", sha256), false);
  assert.equal(await verifyLoupeClipboard("article text", "0".repeat(64)), false);
  assert.equal(await verifyLoupeClipboard("article text", "not-hex"), false);
});

test("hashes with lowercase hexadecimal SHA-256", async () => {
  assert.equal(
    await sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("validates protocol parameters", () => {
  const sha256 = "0".repeat(64);
  assert.deepEqual(parseLoupeImportParams({ file: "Note", source: SOURCE, sha256 }), {
    file: "Note",
    source: SOURCE,
    sha256,
  });
  assert.throws(() => parseLoupeImportParams({ file: "", source: SOURCE, sha256 }), /note name/);
  assert.throws(() => parseLoupeImportParams({ file: "Note", source: "", sha256 }), /source/);
  assert.throws(
    () => parseLoupeImportParams({ file: "Note", source: "not a url", sha256 }),
    /source/,
  );
  assert.throws(
    () => parseLoupeImportParams({ file: "Note", source: SOURCE, sha256: "zz" }),
    /sha256/,
  );
});

test("builds deterministic image paths under z-images", () => {
  assert.equal(
    buildLoupeImagePath("My article", "20260919123456", 1),
    "z-images/My article 20260919123456-01.webp",
  );
  assert.equal(
    buildLoupeImagePath("My article", "20260919123456", 12),
    "z-images/My article 20260919123456-12.webp",
  );
});

test("sanitizes note-derived filename components", () => {
  assert.equal(sanitizeLoupeBasename("a/b:c*d?e<f>g|h#i[j]k"), "a-b-c-d-e-f-g-h-i-j-k");
  assert.equal(sanitizeLoupeBasename(""), "Loupe import");
  assert.equal(
    buildLoupeImagePath("  spaced   out  ", "20260919123456", 1),
    "z-images/spaced out 20260919123456-01.webp",
  );
});

test("never overwrites an existing asset path", () => {
  const taken = new Set(["z-images/Note 20260919123456-01.webp"]);
  const path = firstAvailablePath("z-images/Note 20260919123456-01.webp", (candidate) =>
    taken.has(candidate),
  );

  assert.equal(path, "z-images/Note 20260919123456-01 2.webp");
  assert.equal(
    firstAvailablePath("Note.md", (candidate) => candidate === "Note.md"),
    "Note 2.md",
  );
  assert.equal(
    firstAvailablePath("free.md", () => false),
    "free.md",
  );
});

test("builds note paths in the configured parent folder", () => {
  assert.equal(buildLoupeNotePath("projects", "My article"), "projects/My article.md");
  assert.equal(buildLoupeNotePath("", "My article"), "My article.md");
  assert.equal(buildLoupeNotePath("", "My article.md"), "My article.md");
  assert.equal(buildLoupeNotePath("projects", "a/b"), "projects/a-b.md");
});

test("formats compact sortable timestamps", () => {
  assert.equal(loupeImageTimestamp(new Date("2026-09-19T12:34:56.789Z")), "20260919123456");
});

test("reads content-type headers case-insensitively", () => {
  assert.equal(readResponseContentType({ "Content-Type": "Image/WebP" }), "image/webp");
  assert.equal(readResponseContentType({ "content-type": "image/png" }), "image/png");
  assert.equal(readResponseContentType({}), "");
});

test("recognizes WebP magic bytes", () => {
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
  assert.equal(isWebPBytes(webp.buffer), true);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 0]);
  assert.equal(isWebPBytes(png.buffer), false);
  assert.equal(isWebPBytes(new Uint8Array([1, 2, 3]).buffer), false);
});

test("bounded mapping preserves order", async () => {
  const seen: number[] = [];
  const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
    seen.push(item);
    return item * 10;
  });

  assert.deepEqual(results, [10, 20, 30, 40, 50]);
  assert.equal(seen.length, 5);
});

test("bounded mapping limits concurrent work", async () => {
  let active = 0;
  let maximumActive = 0;

  await mapWithConcurrency([1, 2, 3, 4, 5], 2, async () => {
    active++;
    maximumActive = Math.max(maximumActive, active);
    await Promise.resolve();
    active--;
  });

  assert.equal(maximumActive, 2);
});
