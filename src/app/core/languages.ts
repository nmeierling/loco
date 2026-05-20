export interface LanguageRules {
  id: string;
  name: string;
  lineComment?: string[];
  blockComment?: Array<[string, string]>;
}

const C_FAMILY: Pick<LanguageRules, 'lineComment' | 'blockComment'> = {
  lineComment: ['//'],
  blockComment: [['/*', '*/']],
};

const HASH: Pick<LanguageRules, 'lineComment'> = { lineComment: ['#'] };

const HTML_LIKE: Pick<LanguageRules, 'blockComment'> = {
  blockComment: [['<!--', '-->']],
};

const RULES: Record<string, LanguageRules> = {
  ts: { id: 'ts', name: 'TypeScript', ...C_FAMILY },
  tsx: { id: 'tsx', name: 'TSX', ...C_FAMILY },
  js: { id: 'js', name: 'JavaScript', ...C_FAMILY },
  jsx: { id: 'jsx', name: 'JSX', ...C_FAMILY },
  mjs: { id: 'mjs', name: 'JavaScript', ...C_FAMILY },
  cjs: { id: 'cjs', name: 'JavaScript', ...C_FAMILY },
  java: { id: 'java', name: 'Java', ...C_FAMILY },
  kt: { id: 'kt', name: 'Kotlin', ...C_FAMILY },
  kts: { id: 'kts', name: 'Kotlin', ...C_FAMILY },
  swift: { id: 'swift', name: 'Swift', ...C_FAMILY },
  scala: { id: 'scala', name: 'Scala', ...C_FAMILY },
  rs: { id: 'rs', name: 'Rust', ...C_FAMILY },
  go: { id: 'go', name: 'Go', ...C_FAMILY },
  c: { id: 'c', name: 'C', ...C_FAMILY },
  h: { id: 'h', name: 'C Header', ...C_FAMILY },
  cpp: { id: 'cpp', name: 'C++', ...C_FAMILY },
  cc: { id: 'cc', name: 'C++', ...C_FAMILY },
  hpp: { id: 'hpp', name: 'C++ Header', ...C_FAMILY },
  cs: { id: 'cs', name: 'C#', ...C_FAMILY },
  php: { id: 'php', name: 'PHP', lineComment: ['//', '#'], blockComment: [['/*', '*/']] },
  dart: { id: 'dart', name: 'Dart', ...C_FAMILY },
  m: { id: 'm', name: 'Objective-C', ...C_FAMILY },
  py: { id: 'py', name: 'Python', ...HASH },
  rb: { id: 'rb', name: 'Ruby', ...HASH },
  sh: { id: 'sh', name: 'Shell', ...HASH },
  bash: { id: 'bash', name: 'Bash', ...HASH },
  zsh: { id: 'zsh', name: 'Zsh', ...HASH },
  yaml: { id: 'yaml', name: 'YAML', ...HASH },
  yml: { id: 'yml', name: 'YAML', ...HASH },
  toml: { id: 'toml', name: 'TOML', ...HASH },
  ini: { id: 'ini', name: 'INI', lineComment: [';', '#'] },
  conf: { id: 'conf', name: 'Config', ...HASH },
  dockerfile: { id: 'dockerfile', name: 'Dockerfile', ...HASH },
  makefile: { id: 'makefile', name: 'Makefile', ...HASH },
  sql: { id: 'sql', name: 'SQL', lineComment: ['--'], blockComment: [['/*', '*/']] },
  css: { id: 'css', name: 'CSS', blockComment: [['/*', '*/']] },
  scss: { id: 'scss', name: 'SCSS', ...C_FAMILY },
  sass: { id: 'sass', name: 'Sass', lineComment: ['//'] },
  less: { id: 'less', name: 'Less', ...C_FAMILY },
  html: { id: 'html', name: 'HTML', ...HTML_LIKE },
  htm: { id: 'htm', name: 'HTML', ...HTML_LIKE },
  xml: { id: 'xml', name: 'XML', ...HTML_LIKE },
  svg: { id: 'svg', name: 'SVG', ...HTML_LIKE },
  vue: { id: 'vue', name: 'Vue', ...HTML_LIKE },
  md: { id: 'md', name: 'Markdown' },
  json: { id: 'json', name: 'JSON' },
  jsonc: { id: 'jsonc', name: 'JSONC', ...C_FAMILY },
  lua: { id: 'lua', name: 'Lua', lineComment: ['--'], blockComment: [['--[[', ']]']] },
  ex: { id: 'ex', name: 'Elixir', ...HASH },
  exs: { id: 'exs', name: 'Elixir', ...HASH },
  hs: { id: 'hs', name: 'Haskell', lineComment: ['--'], blockComment: [['{-', '-}']] },
  clj: { id: 'clj', name: 'Clojure', lineComment: [';'] },
  el: { id: 'el', name: 'Emacs Lisp', lineComment: [';'] },
};

const SPECIAL_NAMES: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  rakefile: 'rb',
  gemfile: 'rb',
};

export function detectLanguage(filename: string): LanguageRules | null {
  const lower = filename.toLowerCase();
  const specialKey = Object.keys(SPECIAL_NAMES).find((n) => lower === n || lower.endsWith('.' + n));
  if (specialKey) {
    const id = SPECIAL_NAMES[specialKey];
    if (id) return RULES[id] ?? null;
  }
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = lower.slice(dot + 1);
  return RULES[ext] ?? null;
}

export function extOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return '';
  return filename.slice(dot + 1).toLowerCase();
}
