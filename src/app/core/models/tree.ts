export type MetricKind = 'loc' | 'complexity' | 'churn';

export interface FileMetrics {
  loc: number | null;
  complexity: number | null;
  churn: number | null;
}

export interface FileNode {
  kind: 'file';
  name: string;
  path: string;
  size: number;
  ext: string;
  language: string | null;
  metrics: FileMetrics;
}

export interface DirNode {
  kind: 'dir';
  name: string;
  path: string;
  children: TreeNode[];
}

export type TreeNode = FileNode | DirNode;

export function isDir(n: TreeNode): n is DirNode {
  return n.kind === 'dir';
}

export function isFile(n: TreeNode): n is FileNode {
  return n.kind === 'file';
}

export function walk(node: TreeNode, visit: (n: TreeNode) => void): void {
  visit(node);
  if (isDir(node)) {
    for (const child of node.children) walk(child, visit);
  }
}

export function metricValue(n: TreeNode, metric: MetricKind): number {
  if (isDir(n)) {
    let sum = 0;
    for (const c of n.children) sum += metricValue(c, metric);
    return sum;
  }
  const v = n.metrics[metric];
  return v ?? 0;
}

export function fileCount(n: TreeNode): number {
  if (isFile(n)) return 1;
  let total = 0;
  for (const c of n.children) total += fileCount(c);
  return total;
}
