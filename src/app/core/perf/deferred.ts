import { DestroyRef, Signal, effect, inject, signal, untracked } from '@angular/core';
import { afterPaint } from './schedule';

export interface DeferredLayout<T> {
  /** Last completed result. Holds the previous layout while a new one is building. */
  readonly value: Signal<T>;
  /** True from the moment the inputs change until the new layout lands. */
  readonly building: Signal<boolean>;
}

export interface DeferredLayoutConfig<I, T> {
  /**
   * Reads every signal the build depends on and returns them as one value. The build
   * runs *detached* from the reactive graph, so anything not read here will not trigger
   * a rebuild — declare it all.
   */
  inputs: () => I;
  /** The expensive, synchronous layout. Must be pure with respect to `input`. */
  build: (input: I) => T;
  /** Shown until the first build completes. */
  initial: T;
  /**
   * How much work `input` represents (usually a file count). Inputs lighter than
   * `threshold` are built inline — deferring a 30-file treemap just adds a frame of
   * latency and a spinner flash.
   */
  weight?: (input: I) => number;
  threshold?: number;
}

const DEFAULT_THRESHOLD = 400;

/**
 * Moves a heavy synchronous layout off the render path and exposes a `building` flag
 * for an in-view spinner.
 *
 * Computing a 3000-file treemap inside a `computed()` (or straight inside an effect)
 * means the browser goes from "inputs changed" to "new frame" without ever painting in
 * between — so there is no frame on which a spinner could appear, and the tab simply
 * freezes. Flipping `building`, letting that frame paint, and only then doing the work
 * costs one frame and turns a freeze into visible progress.
 *
 * Must be called from an injection context.
 */
export function deferredLayout<I, T>(cfg: DeferredLayoutConfig<I, T>): DeferredLayout<T> {
  const destroyRef = inject(DestroyRef);
  const value = signal<T>(cfg.initial);
  const building = signal(false);
  const threshold = cfg.threshold ?? DEFAULT_THRESHOLD;
  let cancel: (() => void) | null = null;

  const run = (input: I): void => {
    try {
      value.set(untracked(() => cfg.build(input)));
    } finally {
      building.set(false);
    }
  };

  effect(() => {
    const input = cfg.inputs();
    if (cancel) {
      cancel();
      cancel = null;
    }
    const weigh = cfg.weight;
    const weight = weigh ? untracked(() => weigh(input)) : Number.POSITIVE_INFINITY;
    if (weight <= threshold) {
      run(input);
      return;
    }
    building.set(true);
    cancel = afterPaint(() => {
      cancel = null;
      run(input);
    });
  });

  destroyRef.onDestroy(() => cancel?.());

  return { value, building };
}
