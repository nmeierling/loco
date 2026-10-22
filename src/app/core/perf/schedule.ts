import { DestroyRef, Signal, signal } from '@angular/core';

/**
 * Runs `fn` after the browser has painted the current frame.
 *
 * The rAF callback runs *before* paint, so the timeout queued from inside it is the
 * first thing to run once the frame is on screen. That ordering is what makes an
 * in-view spinner actually visible: flip the flag, let the frame paint, then do the
 * blocking work.
 */
export function afterPaint(fn: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const raf = requestAnimationFrame(() => {
    timer = setTimeout(fn, 0);
  });
  return () => {
    cancelAnimationFrame(raf);
    if (timer !== null) clearTimeout(timer);
  };
}

export interface SizeTracker {
  /** Live pane size, coalesced to one update per frame. Drive SVG viewport attrs off this. */
  readonly width: Signal<number>;
  readonly height: Signal<number>;
  /**
   * The same size, but only once the pane has stopped changing. Expensive layouts key
   * off this, so dragging the sidebar divider doesn't re-run a 3000-file treemap on
   * every frame of the drag.
   */
  readonly settledWidth: Signal<number>;
  readonly settledHeight: Signal<number>;
  /** Call once the host element exists (`ngAfterViewInit`). */
  attach(el: Element, destroyRef: DestroyRef): void;
}

/**
 * ResizeObserver → signals, with the two-speed split above.
 *
 * Created without an element so it can be constructed in a field initializer (where the
 * injection context for `deferredLayout` lives) and attached later from the view hook.
 */
export function createSizeTracker(settleMs = 120): SizeTracker {
  const width = signal(0);
  const height = signal(0);
  const settledWidth = signal(0);
  const settledHeight = signal(0);

  let pending: { w: number; h: number } | null = null;
  let raf = 0;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    raf = 0;
    const next = pending;
    pending = null;
    if (!next) return;
    width.set(next.w);
    height.set(next.h);
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      settledWidth.set(next.w);
      settledHeight.set(next.h);
    }, settleMs);
  };

  return {
    width,
    height,
    settledWidth,
    settledHeight,
    attach(el, destroyRef) {
      const ro = new ResizeObserver((entries) => {
        const last = entries[entries.length - 1];
        if (!last) return;
        const r = last.contentRect;
        pending = { w: Math.max(0, Math.floor(r.width)), h: Math.max(0, Math.floor(r.height)) };
        if (raf === 0) raf = requestAnimationFrame(flush);
      });
      ro.observe(el);

      // Seed synchronously so the first layout doesn't wait a frame for the observer.
      const rect = el.getBoundingClientRect();
      const w0 = Math.max(0, Math.floor(rect.width));
      const h0 = Math.max(0, Math.floor(rect.height));
      width.set(w0);
      height.set(h0);
      settledWidth.set(w0);
      settledHeight.set(h0);

      destroyRef.onDestroy(() => {
        ro.disconnect();
        if (raf !== 0) cancelAnimationFrame(raf);
        if (settleTimer !== null) clearTimeout(settleTimer);
      });
    },
  };
}
