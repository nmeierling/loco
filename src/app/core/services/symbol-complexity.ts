import { AstNode } from './complexity.service';
import { LANG_MAP } from './treesitter-langs';
import { FileSymbol } from './symbols';

/**
 * Branch count per declaration in one file, keyed by the declaring {@link FileSymbol}.
 *
 * The file-wide complexity metric counts every branch node in a file and reports one
 * number; this splits that same count across the functions/methods a branch actually sits
 * in, so a flow can accumulate branching along the path it runs. Attribution is by AST
 * span: a branch is credited to the innermost declaration whose range contains it. A
 * declaration with no branches gets the base score of 1, matching the file-wide `1 + count`
 * convention in the worker's `handleCompute`.
 */
export function perSymbolComplexity(
  ast: AstNode,
  langId: string,
  symbols: readonly FileSymbol[],
): Map<FileSymbol, number> {
  const counts = new Map<FileSymbol, number>();
  for (const s of symbols) counts.set(s, 1);

  const branches = LANG_MAP[langId]?.branches;
  if (!branches || symbols.length === 0) return counts;

  // Innermost-containing declaration wins, so a branch in a method is credited to the
  // method rather than its class. Smallest span first mirrors the encloser logic in
  // `resolve()`.
  const bySpan = [...symbols].sort((a, b) => spanOf(a) - spanOf(b));
  const enclosing = (row: number, col: number): FileSymbol | null => {
    for (const s of bySpan) {
      if (row < s.startRow || row > s.endRow) continue;
      if (row === s.startRow && col < s.startCol) continue;
      if (row === s.endRow && col > s.endCol) continue;
      return s;
    }
    return null;
  };

  const visit = (node: AstNode): void => {
    if (branches.has(node.type)) {
      const owner = enclosing(node.startRow, node.startCol);
      if (owner) counts.set(owner, (counts.get(owner) ?? 1) + 1);
    }
    for (const c of node.children) visit(c);
  };
  visit(ast);

  return counts;
}

function spanOf(s: FileSymbol): number {
  return (s.endRow - s.startRow) * 10_000 + (s.endCol - s.startCol);
}
