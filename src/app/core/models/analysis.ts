export type AnalysisPhase =
  | { phase: 'idle' }
  | { phase: 'loading'; message: string }
  | { phase: 'counting'; done: number; total: number }
  | { phase: 'ready' }
  | { phase: 'error'; message: string };
