export const CHUNK_LIMITS = {
  maxLines: 60,
  maxChars: 1_500,
} as const;

export interface SourceChunk {
  path: string;
  chunkIndex: number;
  startLine: number;
  endLine: number;
  content: string;
}

interface LineRange {
  start: number;
  end: number;
}

/** One-based inclusive line ranges over the original source string. */
function lineRanges(source: string): LineRange[] {
  if (source.length === 0) return [];

  const ranges: LineRange[] = [];
  let lineStart = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") {
      ranges.push({ start: lineStart, end: index });
      lineStart = index + 1;
    }
  }
  ranges.push({ start: lineStart, end: source.length });
  return ranges;
}

function sliceLines(source: string, ranges: LineRange[], startLine: number, endLine: number): string {
  const start = ranges[startLine - 1]?.start ?? 0;
  const endIndex = endLine - 1;
  if (endIndex < ranges.length - 1) {
    return source.slice(start, ranges[endIndex + 1].start);
  }
  return source.slice(start, ranges[endIndex]?.end ?? source.length);
}

function lineCharCount(source: string, ranges: LineRange[], startLine: number, endLine: number): number {
  return sliceLines(source, ranges, startLine, endLine).length;
}

/**
 * Splits one file into non-overlapping chunks.
 * A single line longer than the character limit becomes its own chunk with the full line text.
 * That line is not truncated.
 */
export function chunkSource(path: string, source: string): SourceChunk[] {
  const ranges = lineRanges(source);
  if (ranges.length === 0) return [];

  const chunks: SourceChunk[] = [];
  let lineStart = 1;
  let chunkIndex = 0;

  while (lineStart <= ranges.length) {
    const singleLineChars = lineCharCount(source, ranges, lineStart, lineStart);
    if (singleLineChars > CHUNK_LIMITS.maxChars) {
      chunks.push({
        path,
        chunkIndex,
        startLine: lineStart,
        endLine: lineStart,
        content: sliceLines(source, ranges, lineStart, lineStart),
      });
      chunkIndex += 1;
      lineStart += 1;
      continue;
    }

    let lineEnd = lineStart;
    while (lineEnd < ranges.length) {
      const nextEnd = lineEnd + 1;
      const nextLineCount = nextEnd - lineStart + 1;
      const nextCharCount = lineCharCount(source, ranges, lineStart, nextEnd);
      if (nextLineCount > CHUNK_LIMITS.maxLines || nextCharCount > CHUNK_LIMITS.maxChars) {
        break;
      }
      lineEnd = nextEnd;
    }

    chunks.push({
      path,
      chunkIndex,
      startLine: lineStart,
      endLine: lineEnd,
      content: sliceLines(source, ranges, lineStart, lineEnd),
    });
    chunkIndex += 1;
    lineStart = lineEnd + 1;
  }

  return chunks;
}

/** Joins chunks in order; equals the original source when chunking used default limits. */
export function joinSourceChunks(chunks: SourceChunk[]): string {
  return chunks.map((chunk) => chunk.content).join("");
}
