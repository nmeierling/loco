export interface LangSpec {
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

export const LANG_MAP: Record<string, LangSpec> = {
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

export const SUPPORTED_LANG_IDS: ReadonlySet<string> = new Set(Object.keys(LANG_MAP));
