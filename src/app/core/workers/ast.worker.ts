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

export type TokenKind = 'comment' | 'string' | 'number' | 'keyword' | 'ident';

export interface HighlightTokenWire {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
  kind: TokenKind;
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
interface HighlightMsg {
  type: 'highlight';
  id: number;
  text: string;
  langId: string;
}
interface SupportsMsg {
  type: 'supports';
  id: number;
  langId: string | null;
}
type IncomingMsg = InitMsg | ComputeMsg | ParseMsg | HighlightMsg | SupportsMsg;

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

async function handleHighlight(
  text: string,
  langId: string,
): Promise<HighlightTokenWire[] | null> {
  if (text.length > MAX_AST_BYTES) return null;
  const loaded = await getLang(langId);
  if (!loaded) return null;
  const tree = loaded.parser.parse(text);
  if (!tree) return null;
  const tokens: HighlightTokenWire[] = [];
  const cursor = tree.walk();
  try {
    const visit = (): void => {
      const hasChild = cursor.gotoFirstChild();
      if (hasChild) {
        do {
          visit();
        } while (cursor.gotoNextSibling());
        cursor.gotoParent();
        return;
      }
      // leaf
      const type = cursor.nodeType;
      const named = cursor.nodeIsNamed;
      const startRow = cursor.startPosition.row;
      const startCol = cursor.startPosition.column;
      const endRow = cursor.endPosition.row;
      const endCol = cursor.endPosition.column;
      if (startRow === endRow && startCol === endCol) return; // skip zero-width
      const kind = classifyToken(type, named);
      if (kind) tokens.push({ startRow, startCol, endRow, endCol, kind });
    };
    visit();
  } finally {
    cursor.delete();
  }
  tree.delete();
  return tokens;
}

function classifyToken(type: string, named: boolean): TokenKind | null {
  // Comments — tree-sitter grammars consistently use "comment" in the type name.
  if (type === 'comment' || type.endsWith('_comment') || type.startsWith('comment')) {
    return 'comment';
  }
  // Strings + chars across grammars. Includes template_string, raw_string,
  // string_literal, character_literal, escape_sequence (still string-y).
  if (
    type.includes('string') ||
    type === 'character_literal' ||
    type === 'char_literal' ||
    type === 'escape_sequence'
  ) {
    return 'string';
  }
  // Numeric literals across grammars (TS uses 'number'; Java/Kotlin use *_literal).
  if (
    type === 'number' ||
    type === 'integer' ||
    type === 'float' ||
    type === 'integer_literal' ||
    type === 'long_literal' ||
    type === 'float_literal' ||
    type === 'double_literal' ||
    type === 'real_literal' ||
    type === 'decimal_integer_literal' ||
    type === 'hex_integer_literal' ||
    type === 'binary_integer_literal' ||
    type === 'octal_integer_literal'
  ) {
    return 'number';
  }
  if (named) {
    if (
      type === 'identifier' ||
      type === 'type_identifier' ||
      type === 'property_identifier' ||
      type === 'field_identifier' ||
      type === 'shorthand_property_identifier' ||
      type === 'statement_identifier'
    ) {
      return 'ident';
    }
    return null;
  }
  // Anonymous leaf with a word-shaped type → keyword.
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(type)) return 'keyword';
  return null;
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
    case 'highlight': {
      try {
        const v = await handleHighlight(msg.text, msg.langId);
        reply(msg.id, v);
      } catch (e) {
        replyError(msg.id, e instanceof Error ? e.message : String(e));
      }
      return;
    }
  }
});
