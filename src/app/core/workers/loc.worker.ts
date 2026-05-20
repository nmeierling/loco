/// <reference lib="webworker" />

export interface CountRequest {
  type: 'count';
  id: number;
  path: string;
  text: string;
  lineComment: string[] | null;
  blockComment: Array<[string, string]> | null;
}

export interface CountResponse {
  type: 'result';
  id: number;
  loc: number;
  blank: number;
  comment: number;
  complexity: number;
}

const BRANCH_PATTERN =
  /\b(if|else\s+if|elif|for|foreach|while|case|when|catch|except|switch|select|try)\b|\?\.|\?\?|&&|\|\||\?\s*[^.:?]/g;

function countLoc(req: CountRequest): CountResponse {
  const { text, lineComment, blockComment } = req;
  let loc = 0;
  let blank = 0;
  let comment = 0;

  const lineMarkers = lineComment ?? [];
  const blockMarkers = blockComment ?? [];

  let inBlock = false;
  let blockEnd = '';

  const lines = text.split(/\r\n|\n|\r/);
  for (let raw of lines) {
    let stripped = raw;

    if (inBlock) {
      const idx = stripped.indexOf(blockEnd);
      if (idx >= 0) {
        stripped = stripped.slice(idx + blockEnd.length);
        inBlock = false;
        blockEnd = '';
      } else {
        comment++;
        continue;
      }
    }

    let consumedBlock = false;
    for (const [start, end] of blockMarkers) {
      while (true) {
        const startIdx = stripped.indexOf(start);
        if (startIdx < 0) break;
        const endIdx = stripped.indexOf(end, startIdx + start.length);
        if (endIdx < 0) {
          stripped = stripped.slice(0, startIdx);
          inBlock = true;
          blockEnd = end;
          consumedBlock = true;
          break;
        }
        stripped = stripped.slice(0, startIdx) + stripped.slice(endIdx + end.length);
      }
      if (inBlock) break;
    }

    const trimmed = stripped.trim();
    if (trimmed.length === 0) {
      if (consumedBlock || raw.trim().length > 0) comment++;
      else blank++;
      continue;
    }

    let isLineComment = false;
    for (const m of lineMarkers) {
      if (trimmed.startsWith(m)) {
        isLineComment = true;
        break;
      }
    }
    if (isLineComment) {
      comment++;
    } else {
      loc++;
    }
  }

  let complexity = 1;
  const matches = req.text.match(BRANCH_PATTERN);
  if (matches) complexity += matches.length;

  return { type: 'result', id: req.id, loc, blank, comment, complexity };
}

addEventListener('message', (ev: MessageEvent<CountRequest>) => {
  const data = ev.data;
  if (data.type !== 'count') return;
  try {
    const res = countLoc(data);
    (postMessage as (m: CountResponse) => void)(res);
  } catch {
    (postMessage as (m: CountResponse) => void)({
      type: 'result',
      id: data.id,
      loc: 0,
      blank: 0,
      comment: 0,
      complexity: 0,
    });
  }
});
