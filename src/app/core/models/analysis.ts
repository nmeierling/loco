export type AnalysisPhase =
  | { phase: 'idle' }
  | { phase: 'reading'; done: number }
  | { phase: 'loading'; message: string }
  | { phase: 'counting'; done: number; total: number }
  | { phase: 'parsing'; done: number; total: number }
  | { phase: 'ready' }
  | { phase: 'error'; message: string };

/**
 * Churn runs after the tree is on screen — walking git history is slow and nothing
 * else depends on it, so it reports progress separately from {@link AnalysisPhase}
 * instead of holding up the main spinner.
 */
export type ChurnState =
  | { status: 'unavailable' }
  | { status: 'pending' }
  | { status: 'running'; done: number; total: number }
  | { status: 'ready'; filesWithChurn: number; commitsScanned: number }
  | { status: 'error'; message: string };
