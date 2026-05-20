export type AnalysisPhase =
  | { phase: 'idle' }
  | { phase: 'reading'; done: number }
  | { phase: 'loading'; message: string }
  | { phase: 'counting'; done: number; total: number }
  | { phase: 'parsing'; done: number; total: number }
  | { phase: 'ready' }
  | { phase: 'error'; message: string };
