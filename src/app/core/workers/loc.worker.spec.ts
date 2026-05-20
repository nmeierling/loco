import { describe, expect, it } from 'vitest';
import { countLoc, type CountRequest } from './loc.worker';

function req(text: string, opts: Partial<CountRequest> = {}): CountRequest {
  return {
    type: 'count',
    id: 1,
    path: 'x.ts',
    text,
    lineComment: ['//'],
    blockComment: [['/*', '*/']],
    ...opts,
  };
}

describe('countLoc — code/blank/comment classification', () => {
  it('counts blank, comment, and code lines for TS', () => {
    const text = [
      'import { a } from "a";',
      '',
      '// this is a comment',
      'export function foo() {',
      '  /* multi',
      '     line */',
      '  return a;',
      '}',
    ].join('\n');
    const r = countLoc(req(text));
    expect(r.loc).toBe(4); // import, function header, return, closing brace
    expect(r.blank).toBe(1);
    expect(r.comment).toBe(3);
  });

  it('handles inline block comments that leave code on the same line', () => {
    const text = 'const x = /* comment */ 1;';
    const r = countLoc(req(text));
    expect(r.loc).toBe(1);
    expect(r.comment).toBe(0);
  });

  it('treats hash-comments as comments for Python', () => {
    const r = countLoc(
      req(
        ['# header', 'x = 1', '', '# trailing'].join('\n'),
        { lineComment: ['#'], blockComment: null },
      ),
    );
    expect(r.loc).toBe(1);
    expect(r.comment).toBe(2);
    expect(r.blank).toBe(1);
  });
});

describe('countLoc — complexity heuristic', () => {
  it('starts at 1 with no branches', () => {
    expect(countLoc(req('const x = 1;')).complexity).toBe(1);
  });

  it('increments for each if/for/while/case keyword', () => {
    const text = [
      'function f(n) {',
      '  if (n > 0) {}',
      '  for (let i = 0; i < n; i++) {}',
      '  while (n--) {}',
      '  switch (n) { case 1: break; }',
      '}',
    ].join('\n');
    const r = countLoc(req(text));
    expect(r.complexity).toBeGreaterThan(1);
  });
});
