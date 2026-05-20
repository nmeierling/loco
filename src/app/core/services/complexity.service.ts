import { Injectable } from '@angular/core';
import Parser from 'web-tree-sitter';

export interface AstNode {
  type: string;
  named: boolean;
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
  preview: string;
  children: AstNode[];
}

export interface ComplexityProvider {
  readonly id: string;
  supports(languageId: string | null): boolean;
  /** Returns null if this provider can't compute complexity for the given language. */
  compute(text: string, languageId: string | null): Promise<number | null>;
  /** Returns a JSON-serializable AST snapshot, or null if not supported. */
  parse(text: string, languageId: string | null): Promise<AstNode | null>;
}

@Injectable({ providedIn: 'root' })
export class ComplexityService {
  private provider: ComplexityProvider | null = null;

  setProvider(p: ComplexityProvider | null): void {
    this.provider = p;
  }

  hasProvider(): boolean {
    return this.provider !== null;
  }

  supports(languageId: string | null): boolean {
    return this.provider ? this.provider.supports(languageId) : false;
  }

  async compute(text: string, languageId: string | null): Promise<number | null> {
    if (!this.provider) return null;
    return this.provider.compute(text, languageId);
  }

  async parse(text: string, languageId: string | null): Promise<AstNode | null> {
    if (!this.provider) return null;
    return this.provider.parse(text, languageId);
  }
}

interface LangSpec {
  grammar: string;
  branches: ReadonlySet<string>;
}

const TS_JS_BRANCHES: ReadonlySet<string> = new Set([
  'if_statement',
  'switch_case',
  'switch_default',
  'while_statement',
  'do_statement',
  'for_statement',
  'for_in_statement',
  'for_of_statement',
  'catch_clause',
  'ternary_expression',
]);

const PY_BRANCHES: ReadonlySet<string> = new Set([
  'if_statement',
  'elif_clause',
  'while_statement',
  'for_statement',
  'except_clause',
  'conditional_expression',
  'case_clause',
]);

const RUST_BRANCHES: ReadonlySet<string> = new Set([
  'if_expression',
  'while_expression',
  'for_expression',
  'match_arm',
  'try_expression',
]);

const GO_BRANCHES: ReadonlySet<string> = new Set([
  'if_statement',
  'for_statement',
  'expression_case',
  'type_case',
  'communication_case',
]);

const JAVA_BRANCHES: ReadonlySet<string> = new Set([
  'if_statement',
  'while_statement',
  'do_statement',
  'for_statement',
  'enhanced_for_statement',
  'switch_label',
  'catch_clause',
  'ternary_expression',
]);

const C_BRANCHES: ReadonlySet<string> = new Set([
  'if_statement',
  'while_statement',
  'do_statement',
  'for_statement',
  'case_statement',
  'conditional_expression',
]);

const CS_BRANCHES: ReadonlySet<string> = new Set([
  'if_statement',
  'while_statement',
  'do_statement',
  'for_statement',
  'for_each_statement',
  'switch_section',
  'catch_clause',
  'conditional_expression',
]);

const PHP_BRANCHES: ReadonlySet<string> = new Set([
  'if_statement',
  'while_statement',
  'for_statement',
  'foreach_statement',
  'case_statement',
  'catch_clause',
  'conditional_expression',
  'match_condition_list',
]);

const RUBY_BRANCHES: ReadonlySet<string> = new Set([
  'if',
  'elsif',
  'unless',
  'while',
  'until',
  'for',
  'when',
  'rescue',
  'conditional',
]);

const BASH_BRANCHES: ReadonlySet<string> = new Set([
  'if_statement',
  'elif_clause',
  'while_statement',
  'for_statement',
  'case_item',
]);

const LUA_BRANCHES: ReadonlySet<string> = new Set([
  'if_statement',
  'elseif_statement',
  'while_statement',
  'repeat_statement',
  'for_numeric_statement',
  'for_generic_statement',
]);

const ELIXIR_BRANCHES: ReadonlySet<string> = new Set([
  'when_clause',
  'rescue_clause',
  'after_block',
  'do_block',
]);

const LANG_MAP: Record<string, LangSpec> = {
  ts: { grammar: 'tree-sitter-typescript.wasm', branches: TS_JS_BRANCHES },
  tsx: { grammar: 'tree-sitter-tsx.wasm', branches: TS_JS_BRANCHES },
  js: { grammar: 'tree-sitter-javascript.wasm', branches: TS_JS_BRANCHES },
  jsx: { grammar: 'tree-sitter-javascript.wasm', branches: TS_JS_BRANCHES },
  mjs: { grammar: 'tree-sitter-javascript.wasm', branches: TS_JS_BRANCHES },
  cjs: { grammar: 'tree-sitter-javascript.wasm', branches: TS_JS_BRANCHES },
  py: { grammar: 'tree-sitter-python.wasm', branches: PY_BRANCHES },
  rs: { grammar: 'tree-sitter-rust.wasm', branches: RUST_BRANCHES },
  go: { grammar: 'tree-sitter-go.wasm', branches: GO_BRANCHES },
  java: { grammar: 'tree-sitter-java.wasm', branches: JAVA_BRANCHES },
  c: { grammar: 'tree-sitter-c.wasm', branches: C_BRANCHES },
  h: { grammar: 'tree-sitter-c.wasm', branches: C_BRANCHES },
  cpp: { grammar: 'tree-sitter-cpp.wasm', branches: C_BRANCHES },
  cc: { grammar: 'tree-sitter-cpp.wasm', branches: C_BRANCHES },
  hpp: { grammar: 'tree-sitter-cpp.wasm', branches: C_BRANCHES },
  cs: { grammar: 'tree-sitter-c_sharp.wasm', branches: CS_BRANCHES },
  php: { grammar: 'tree-sitter-php.wasm', branches: PHP_BRANCHES },
  rb: { grammar: 'tree-sitter-ruby.wasm', branches: RUBY_BRANCHES },
  sh: { grammar: 'tree-sitter-bash.wasm', branches: BASH_BRANCHES },
  bash: { grammar: 'tree-sitter-bash.wasm', branches: BASH_BRANCHES },
  zsh: { grammar: 'tree-sitter-bash.wasm', branches: BASH_BRANCHES },
  kt: { grammar: 'tree-sitter-kotlin.wasm', branches: TS_JS_BRANCHES },
  kts: { grammar: 'tree-sitter-kotlin.wasm', branches: TS_JS_BRANCHES },
  swift: { grammar: 'tree-sitter-swift.wasm', branches: TS_JS_BRANCHES },
  scala: { grammar: 'tree-sitter-scala.wasm', branches: TS_JS_BRANCHES },
  dart: { grammar: 'tree-sitter-dart.wasm', branches: TS_JS_BRANCHES },
  lua: { grammar: 'tree-sitter-lua.wasm', branches: LUA_BRANCHES },
  ex: { grammar: 'tree-sitter-elixir.wasm', branches: ELIXIR_BRANCHES },
  exs: { grammar: 'tree-sitter-elixir.wasm', branches: ELIXIR_BRANCHES },
};

interface LoadedLang {
  parser: Parser;
  language: Parser.Language;
  branches: ReadonlySet<string>;
}

const MAX_AST_BYTES = 1_000_000;

export class TreeSitterComplexityProvider implements ComplexityProvider {
  readonly id = 'tree-sitter';
  private readonly grammarsPath: string;
  private initialized: Promise<void> | null = null;
  private readonly languages = new Map<string, Promise<LoadedLang | null>>();

  constructor(grammarsPath = '/grammars') {
    this.grammarsPath = grammarsPath;
  }

  supports(languageId: string | null): boolean {
    return languageId !== null && languageId in LANG_MAP;
  }

  private ensureInit(): Promise<void> {
    if (!this.initialized) {
      this.initialized = Parser.init({
        locateFile: (file: string) => `${this.grammarsPath}/${file}`,
      });
    }
    return this.initialized;
  }

  private getLang(langId: string): Promise<LoadedLang | null> {
    let cached = this.languages.get(langId);
    if (cached) return cached;
    const spec = LANG_MAP[langId];
    if (!spec) return Promise.resolve(null);
    cached = (async () => {
      try {
        await this.ensureInit();
        const language = await Parser.Language.load(`${this.grammarsPath}/${spec.grammar}`);
        const parser = new Parser();
        parser.setLanguage(language);
        return { parser, language, branches: spec.branches };
      } catch (e) {
        console.warn('[loco] Failed to load grammar', spec.grammar, e);
        return null;
      }
    })();
    this.languages.set(langId, cached);
    return cached;
  }

  async compute(text: string, languageId: string | null): Promise<number | null> {
    if (!languageId) return null;
    if (text.length > MAX_AST_BYTES) return null;
    const loaded = await this.getLang(languageId);
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


  async parse(text: string, languageId: string | null): Promise<AstNode | null> {
    if (!languageId) return null;
    if (text.length > MAX_AST_BYTES) return null;
    const loaded = await this.getLang(languageId);
    if (!loaded) return null;
    const tree = loaded.parser.parse(text);
    if (!tree) return null;
    try {
      return snapshot(tree.rootNode);
    } finally {
      tree.delete();
    }
  }
}

function snapshot(node: Parser.SyntaxNode): AstNode {
  const preview = previewText(node.text);
  const children: AstNode[] = [];
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

function previewText(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > 80 ? oneLine.slice(0, 77) + '…' : oneLine;
}
