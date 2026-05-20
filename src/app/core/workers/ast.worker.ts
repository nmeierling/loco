/// <reference lib="webworker" />

import Parser from 'web-tree-sitter';
import { LANG_MAP, SUPPORTED_LANG_IDS } from '../services/treesitter-langs';

export interface AstNodeWire {
  type: string;
  named: boolean;
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
  preview: string;
  children: AstNodeWire[];
}

interface InitMsg {
  type: 'init';
  grammarsPath: string;
}
interface ComputeMsg {
  type: 'compute';
  id: number;
  text: string;
  langId: string;
}
interface ParseMsg {
  type: 'parse';
  id: number;
  text: string;
  langId: string;
}
interface SupportsMsg {
  type: 'supports';
  id: number;
  langId: string | null;
}
type IncomingMsg = InitMsg | ComputeMsg | ParseMsg | SupportsMsg;

interface OkResult {
  type: 'result';
  id: number;
  result: unknown;
}
interface ErrorResult {
  type: 'result';
  id: number;
  error: string;
}
interface InitDone {
  type: 'init-done';
}

const MAX_AST_BYTES = 1_000_000;

interface LoadedLang {
  parser: Parser;
  language: Parser.Language;
  branches: ReadonlySet<string>;
}

let grammarsPath = '/grammars';
let initPromise: Promise<void> | null = null;
const languages = new Map<string, Promise<LoadedLang | null>>();

function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = Parser.init({
      locateFile: (file: string) => `${grammarsPath}/${file}`,
    });
  }
  return initPromise;
}

function getLang(langId: string): Promise<LoadedLang | null> {
  const cached = languages.get(langId);
  if (cached) return cached;
  const spec = LANG_MAP[langId];
  if (!spec) return Promise.resolve(null);
  const p = (async () => {
    try {
      await ensureInit();
      const language = await Parser.Language.load(`${grammarsPath}/${spec.grammar}`);
      const parser = new Parser();
      parser.setLanguage(language);
      return { parser, language, branches: spec.branches };
    } catch (e) {
      console.warn('[loco worker] failed to load grammar', spec.grammar, e);
      return null;
    }
  })();
  languages.set(langId, p);
  return p;
}

function snapshot(node: Parser.SyntaxNode): AstNodeWire {
  const oneLine = node.text.replace(/\s+/g, ' ').trim();
  const preview = oneLine.length > 80 ? oneLine.slice(0, 77) + '…' : oneLine;
  const children: AstNodeWire[] = [];
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c) children.push(snapshot(c));
  }
  return {
    type: node.type,
    named: true,
    startRow: node.startPosition.row,
    startCol: node.startPosition.column,
    endRow: node.endPosition.row,
    endCol: node.endPosition.column,
    preview,
    children,
  };
}

async function handleParse(text: string, langId: string): Promise<AstNodeWire | null> {
  if (text.length > MAX_AST_BYTES) return null;
  const loaded = await getLang(langId);
  if (!loaded) return null;
  const tree = loaded.parser.parse(text);
  if (!tree) return null;
  try {
    return snapshot(tree.rootNode);
  } finally {
    tree.delete();
  }
}

async function handleCompute(text: string, langId: string): Promise<number | null> {
  if (text.length > MAX_AST_BYTES) return null;
  const loaded = await getLang(langId);
  if (!loaded) return null;
  const tree = loaded.parser.parse(text);
  if (!tree) return null;
  try {
    let count = 0;
    const cursor = tree.walk();
    try {
      const visit = (): void => {
        if (loaded.branches.has(cursor.nodeType)) count++;
        if (cursor.gotoFirstChild()) {
          do {
            visit();
          } while (cursor.gotoNextSibling());
          cursor.gotoParent();
        }
      };
      visit();
    } finally {
      cursor.delete();
    }
    return 1 + count;
  } finally {
    tree.delete();
  }
}

function reply(id: number, result: unknown): void {
  (postMessage as (m: OkResult) => void)({ type: 'result', id, result });
}
function replyError(id: number, error: string): void {
  (postMessage as (m: ErrorResult) => void)({ type: 'result', id, error });
}

addEventListener('message', async (ev: MessageEvent<IncomingMsg>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'init': {
      grammarsPath = msg.grammarsPath;
      try {
        await ensureInit();
        (postMessage as (m: InitDone) => void)({ type: 'init-done' });
      } catch (e) {
        console.warn('[loco worker] init failed', e);
      }
      return;
    }
    case 'supports': {
      const ok = msg.langId !== null && SUPPORTED_LANG_IDS.has(msg.langId);
      reply(msg.id, ok);
      return;
    }
    case 'compute': {
      try {
        const v = await handleCompute(msg.text, msg.langId);
        reply(msg.id, v);
      } catch (e) {
        replyError(msg.id, e instanceof Error ? e.message : String(e));
      }
      return;
    }
    case 'parse': {
      try {
        const v = await handleParse(msg.text, msg.langId);
        reply(msg.id, v);
      } catch (e) {
        replyError(msg.id, e instanceof Error ? e.message : String(e));
      }
      return;
    }
  }
});
