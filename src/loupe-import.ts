// Pure helpers for the Loupe import path (`obsidian://loupe-import`). This
// module is intentionally free of `obsidian` imports so it can be unit tested
// without instantiating Obsidian.

export const LOUPE_IMAGE_FOLDER = "z-images";

export interface LoupeImageOccurrence {
  alt: string;
  destination: string;
  start: number;
  end: number;
}

export interface LoupeRemoteImage {
  resolvedUrl: string;
  firstIndex: number;
}

export interface LoupeImportParams {
  file: string;
  source: string;
  sha256: string;
}

interface CodeRange {
  start: number;
  end: number;
}

function computeCodeRanges(markdown: string): CodeRange[] {
  const ranges: CodeRange[] = [];
  const lineStarts: number[] = [0];
  for (let i = 0; i < markdown.length; i++) {
    if (markdown[i] === "\n") {
      lineStarts.push(i + 1);
    }
  }
  let openFence: { char: string; length: number; start: number } | null = null;
  for (let lineIndex = 0; lineIndex < lineStarts.length; lineIndex++) {
    const lineStart = lineStarts[lineIndex] as number;
    const lineEnd =
      lineIndex + 1 < lineStarts.length ? (lineStarts[lineIndex + 1] as number) - 1 : markdown.length;
    const line = markdown.slice(lineStart, lineEnd);
    const fenceMatch = /^( {0,3})(`{3,}|~{3,})/.exec(line);
    if (fenceMatch === null) {
      continue;
    }
    const fenceRun = fenceMatch[2] as string;
    const fenceChar = fenceRun[0] as string;
    const rest = line.slice(fenceMatch[0].length);
    if (openFence === null) {
      if (fenceChar === "`" && rest.includes("`")) {
        continue;
      }
      openFence = { char: fenceChar, length: fenceRun.length, start: lineStart };
    } else if (
      fenceChar === openFence.char &&
      fenceRun.length >= openFence.length &&
      /^[ \t]*$/.test(rest)
    ) {
      ranges.push({ start: openFence.start, end: lineEnd });
      openFence = null;
    }
  }
  if (openFence !== null) {
    ranges.push({ start: openFence.start, end: markdown.length });
  }

  let cursor = 0;
  const segments: CodeRange[] = [];
  for (const range of ranges) {
    if (cursor < range.start) {
      segments.push({ start: cursor, end: range.start });
    }
    cursor = Math.max(cursor, range.end);
  }
  if (cursor < markdown.length) {
    segments.push({ start: cursor, end: markdown.length });
  }
  for (const segment of segments) {
    let i = segment.start;
    while (i < segment.end) {
      if (markdown[i] !== "`") {
        i++;
        continue;
      }
      let runLength = 0;
      while (markdown[i + runLength] === "`") {
        runLength++;
      }
      let j = i + runLength;
      let closed = false;
      while (j < segment.end) {
        if (markdown[j] !== "`") {
          j++;
          continue;
        }
        let closeLength = 0;
        while (markdown[j + closeLength] === "`") {
          closeLength++;
        }
        if (closeLength === runLength) {
          ranges.push({ start: i, end: j + closeLength });
          i = j + closeLength;
          closed = true;
          break;
        }
        j += closeLength;
      }
      if (!closed) {
        i += runLength;
      }
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  return ranges;
}

function isMarkdownSpace(char: string | undefined): boolean {
  return char === " " || char === "\t" || char === "\n";
}

function parseLinkTitle(markdown: string, pos: number): number | null {
  const opener = markdown[pos];
  if (opener === '"' || opener === "'") {
    let i = pos + 1;
    while (i < markdown.length) {
      const char = markdown[i];
      if (char === "\\") {
        i += 2;
        continue;
      }
      if (char === opener) {
        return i + 1;
      }
      i++;
    }
    return null;
  }
  if (opener === "(") {
    let i = pos + 1;
    let depth = 1;
    while (i < markdown.length) {
      const char = markdown[i];
      if (char === "\\") {
        i += 2;
        continue;
      }
      if (char === "(") {
        depth++;
      } else if (char === ")") {
        depth--;
        if (depth === 0) {
          return i + 1;
        }
      }
      i++;
    }
    return null;
  }
  return null;
}

function parseLinkDestination(
  markdown: string,
  pos: number,
): { destination: string; end: number } | null {
  let i = pos;
  while (isMarkdownSpace(markdown[i])) {
    i++;
  }
  let destination: string;
  if (markdown[i] === "<") {
    i++;
    const start = i;
    while (i < markdown.length && markdown[i] !== ">") {
      if (markdown[i] === "\\") {
        i += 2;
        continue;
      }
      if (markdown[i] === "\n" || markdown[i] === "<") {
        return null;
      }
      i++;
    }
    if (markdown[i] !== ">") {
      return null;
    }
    destination = markdown.slice(start, i);
    i++;
  } else {
    const start = i;
    let depth = 0;
    while (i < markdown.length) {
      const char = markdown[i] as string;
      if (char === "\\") {
        i += 2;
        continue;
      }
      if (char === "(") {
        depth++;
      } else if (char === ")") {
        if (depth === 0) {
          break;
        }
        depth--;
      } else if (isMarkdownSpace(char) || char.charCodeAt(0) < 0x20) {
        break;
      }
      i++;
    }
    destination = markdown.slice(start, i);
  }
  let k = i;
  while (isMarkdownSpace(markdown[k])) {
    k++;
  }
  if (markdown[k] === ")") {
    return { destination, end: k + 1 };
  }
  if (k === i) {
    return null;
  }
  const titleEnd = parseLinkTitle(markdown, k);
  if (titleEnd === null) {
    return null;
  }
  k = titleEnd;
  while (isMarkdownSpace(markdown[k])) {
    k++;
  }
  if (markdown[k] !== ")") {
    return null;
  }
  return { destination, end: k + 1 };
}

function parseImageAt(markdown: string, bangIndex: number): LoupeImageOccurrence | null {
  let depth = 1;
  let j = bangIndex + 2;
  while (j < markdown.length) {
    const char = markdown[j];
    if (char === "\\") {
      j += 2;
      continue;
    }
    if (char === "[") {
      depth++;
    } else if (char === "]") {
      depth--;
      if (depth === 0) {
        break;
      }
    }
    j++;
  }
  if (depth !== 0 || markdown[j + 1] !== "(") {
    return null;
  }
  const parsed = parseLinkDestination(markdown, j + 2);
  if (parsed === null) {
    return null;
  }
  return {
    alt: markdown.slice(bangIndex + 2, j),
    destination: parsed.destination,
    start: bangIndex,
    end: parsed.end,
  };
}

function isMarkdownEscaped(markdown: string, index: number): boolean {
  let backslashCount = 0;
  for (let i = index - 1; i >= 0 && markdown[i] === "\\"; i--) {
    backslashCount++;
  }
  return backslashCount % 2 === 1;
}

export function findLoupeImageOccurrences(markdown: string): LoupeImageOccurrence[] {
  const codeRanges = computeCodeRanges(markdown);
  const occurrences: LoupeImageOccurrence[] = [];
  let i = 0;
  let codeIndex = 0;
  while (i < markdown.length) {
    while (codeIndex < codeRanges.length && i >= (codeRanges[codeIndex] as CodeRange).end) {
      codeIndex++;
    }
    const code = codeIndex < codeRanges.length ? (codeRanges[codeIndex] as CodeRange) : null;
    if (code !== null && i >= code.start) {
      i = code.end;
      continue;
    }
    if (markdown[i] === "!" && markdown[i + 1] === "[" && !isMarkdownEscaped(markdown, i)) {
      const occurrence = parseImageAt(markdown, i);
      if (occurrence !== null) {
        if (code !== null && occurrence.end > code.start) {
          i = code.end;
          continue;
        }
        occurrences.push(occurrence);
        i = occurrence.end;
        continue;
      }
    }
    i++;
  }
  return occurrences;
}

function unescapeMarkdownDestination(destination: string): string {
  return destination.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, "$1");
}

export function resolveLoupeImageUrl(destination: string, sourceUrl: string): string | null {
  const trimmed = unescapeMarkdownDestination(destination).trim();
  if (trimmed === "" || trimmed.startsWith("#")) {
    return null;
  }
  let resolved: URL;
  try {
    resolved = new URL(trimmed, sourceUrl);
  } catch {
    return null;
  }
  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
    return null;
  }
  return resolved.href;
}

export function collectLoupeRemoteImages(
  markdown: string,
  sourceUrl: string,
): LoupeRemoteImage[] {
  const images: LoupeRemoteImage[] = [];
  const seen = new Set<string>();
  for (const occurrence of findLoupeImageOccurrences(markdown)) {
    const resolvedUrl = resolveLoupeImageUrl(occurrence.destination, sourceUrl);
    if (resolvedUrl === null || seen.has(resolvedUrl)) {
      continue;
    }
    seen.add(resolvedUrl);
    images.push({ resolvedUrl, firstIndex: occurrence.start });
  }
  return images;
}

// Rescans the note's current contents so edits made while images were
// downloading survive; only embeds whose resolved URL has a localized mapping
// are rewritten, everything else is preserved byte-for-byte.
export function applyLoupeImageLocalizations(
  currentMarkdown: string,
  sourceUrl: string,
  urlToEmbed: ReadonlyMap<string, string>,
): string {
  let result = "";
  let cursor = 0;
  let replaced = false;
  for (const occurrence of findLoupeImageOccurrences(currentMarkdown)) {
    const resolvedUrl = resolveLoupeImageUrl(occurrence.destination, sourceUrl);
    const embed = resolvedUrl === null ? undefined : urlToEmbed.get(resolvedUrl);
    if (embed === undefined) {
      continue;
    }
    result += currentMarkdown.slice(cursor, occurrence.start) + embed;
    cursor = occurrence.end;
    replaced = true;
  }
  return replaced ? result + currentMarkdown.slice(cursor) : currentMarkdown;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export async function verifyLoupeClipboard(
  clipboardText: string,
  expectedSha256: string,
): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(expectedSha256)) {
    return false;
  }
  return (await sha256Hex(clipboardText)) === expectedSha256;
}

export function parseLoupeImportParams(params: Record<string, string>): LoupeImportParams {
  const file = (params["file"] ?? "").trim();
  const source = (params["source"] ?? "").trim();
  const sha256 = (params["sha256"] ?? "").trim().toLowerCase();
  if (file === "") {
    throw new Error("Loupe import is missing the note name.");
  }
  if (source === "") {
    throw new Error("Loupe import is missing the source URL.");
  }
  try {
    new URL(source);
  } catch {
    throw new Error("Loupe import has an invalid source URL.");
  }
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error("Loupe import has an invalid sha256 parameter.");
  }
  return { file, source, sha256 };
}

export function sanitizeLoupeBasename(name: string): string {
  const sanitized = name
    .replaceAll(/[\\/:*?"<>|#^[\]]/g, "-")
    // eslint-disable-next-line no-control-regex
    .replaceAll(/[\0-\x1F]/g, "-")
    .replaceAll(/\s+/g, " ")
    .trim()
    .replaceAll(/[. ]+$/g, "")
    .slice(0, 100);
  return sanitized || "Loupe import";
}

export function loupeImageTimestamp(now: Date = new Date()): string {
  return now.toISOString().replaceAll(/[-:T]/gu, "").slice(0, 14);
}

export function buildLoupeImagePath(
  noteBasename: string,
  timestamp: string,
  index: number,
): string {
  return `${LOUPE_IMAGE_FOLDER}/${sanitizeLoupeBasename(noteBasename)} ${timestamp}-${String(index).padStart(2, "0")}.webp`;
}

// Deterministic collision handling: never overwrite an existing vault path,
// preferring `Base.md`, `Base 2.md`, `Base 3.md`, ... Obsidian-style suffixes.
export function firstAvailablePath(
  desiredPath: string,
  exists: (path: string) => boolean,
): string {
  if (!exists(desiredPath)) {
    return desiredPath;
  }
  const dotIndex = desiredPath.lastIndexOf(".");
  const base = dotIndex < 0 ? desiredPath : desiredPath.slice(0, dotIndex);
  const extension = dotIndex < 0 ? "" : desiredPath.slice(dotIndex);
  let counter = 2;
  while (exists(`${base} ${counter}${extension}`)) {
    counter++;
  }
  return `${base} ${counter}${extension}`;
}

export function buildLoupeNotePath(parentPath: string, fileName: string): string {
  let base = sanitizeLoupeBasename(fileName);
  if (base.toLowerCase().endsWith(".md")) {
    base = base.slice(0, -".md".length).trim().replaceAll(/[. ]+$/g, "") || "Loupe import";
  }
  const folder = parentPath.replaceAll(/^\/+|\/+$/g, "");
  return folder === "" ? `${base}.md` : `${folder}/${base}.md`;
}

export function readResponseContentType(headers: Record<string, string>): string {
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === "content-type") {
      return value.toLowerCase();
    }
  }
  return "";
}

export function isWebPBytes(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 12) {
    return false;
  }
  const bytes = new Uint8Array(buffer);
  return (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  );
}

export const LOUPE_IMAGE_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export function createLoupeImageRequest(url: string): {
  url: string;
  method: "GET";
  headers: Record<string, string>;
  throw: false;
} {
  return {
    url,
    method: "GET",
    headers: {
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "User-Agent": LOUPE_IMAGE_USER_AGENT,
    },
    throw: false,
  };
}

export function isRetryableLoupeImageStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

export interface ExponentialBackoffOptions {
  attempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  sleep?: (delayMs: number) => Promise<void>;
}

// Retries network errors and result values selected by the caller. The
// injectable sleep function keeps backoff timing deterministic in tests.
export async function retryWithExponentialBackoff<T>(
  operation: () => Promise<T>,
  shouldRetryResult: (result: T) => boolean,
  options: ExponentialBackoffOptions,
): Promise<T> {
  const attempts = Math.max(1, Math.floor(options.attempts)),
    sleep =
      options.sleep ??
      ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const result = await operation();
      if (attempt === attempts - 1 || !shouldRetryResult(result)) {
        return result;
      }
    } catch (error) {
      if (attempt === attempts - 1) {
        throw error;
      }
    }

    const delayMs = Math.min(options.maxDelayMs, options.initialDelayMs * 2 ** attempt);
    await sleep(delayMs);
  }

  throw new Error("Retry operation did not produce a result.");
}

// Bounded worker pool that preserves input order in its results, so filename
// assignment stays in deterministic source order while downloads run
// concurrently. The optional callback runs after each task resolves, in
// completion order.
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
  onItemComplete?: (completed: number) => void,
): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;
  let completed = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item === undefined) {
        continue;
      }
      results[index] = await task(item, index);
      completed += 1;
      onItemComplete?.(completed);
    }
  });
  await Promise.all(workers);
  return results;
}
