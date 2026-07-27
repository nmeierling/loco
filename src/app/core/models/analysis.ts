export type AnalysisPhase =
  | { phase: 'idle' }
  | { phase: 'restoring'; done: number; total: number }
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
/**
 * Risk needs the module graph, so unlike the other metrics it is computed the first
 * time it is selected rather than during analysis.
 */
export type RiskState =
  | { status: 'idle' }
  | { status: 'computing' }
  | { status: 'ready'; projectId: number; usedChurn: boolean; usedFanIn: boolean }
  | { status: 'error'; message: string };

export type ChurnState =
  | { status: 'unavailable' }
  | { status: 'pending' }
  | { status: 'running'; done: number; total: number }
  | { status: 'ready'; filesWithChurn: number; commitsScanned: number }
  | { status: 'error'; message: string };
