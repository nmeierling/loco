/** Numeric metrics stored per file. */
export type MetricKind = 'loc' | 'complexity' | 'churn' | 'risk';

/**
 * What to show next to a file/folder and drive the vizzes by. On top of the stored
 * per-file metrics it adds two derived metrics, computed from the tree rather than
 * stored: `count` (number of files) and `size` (bytes on disk, summed for folders).
 */
export type DisplayMetric = MetricKind | 'count' | 'size';

export interface FileMetrics {
  loc: number | null;
  complexity: number | null;
  churn: number | null;
  /**
   * 0-100 composite of complexity, how many files import this one, and how often it
   * changes. Computed on demand — it needs the module graph — so it stays null until
   * the metric is asked for.
   */
  risk: number | null;
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

export function metricValue(n: TreeNode, metric: DisplayMetric): number {
  // `count` is the number of files in the subtree — a file is 1, a folder the sum.
  if (metric === 'count') return fileCount(n);
  // Folders aggregate every other metric (including `size`) by summing their files.
  if (isDir(n)) {
    let sum = 0;
    for (const c of n.children) sum += metricValue(c, metric);
    return sum;
  }
  if (metric === 'size') return n.size;
  const v = n.metrics[metric];
  return v ?? 0;
}

export function fileCount(n: TreeNode): number {
  if (isFile(n)) return 1;
  let total = 0;
  for (const c of n.children) total += fileCount(c);
  return total;
}

/**
 * Renders a metric value for display next to a file/folder. `size` is a byte count, so
 * it gets K/M/G abbreviations; every other metric is a plain count.
 */
export function formatMetricValue(value: number, metric: DisplayMetric): string {
  if (metric === 'size') return formatSize(value);
  return Math.round(value).toLocaleString();
}

/**
 * Human-readable byte size using decimal abbreviations — K (thousand), M (mega),
 * G (giga). Two digits after the decimal point for gigabytes, none for the rest.
 */
export function formatSize(bytes: number): string {
  const n = Math.max(0, bytes);
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} G`;
  if (n >= 1e6) return `${Math.round(n / 1e6).toLocaleString()} M`;
  if (n >= 1e3) return `${Math.round(n / 1e3).toLocaleString()} K`;
  return `${Math.round(n)} B`;
}
