/**
 * jsdom has no layout engine, so it provides no `ResizeObserver`. Several components
 * construct one to follow their pane size, which makes them throw on instantiation and
 * takes down tests that only wanted to check the component renders at all.
 *
 * A no-op is the honest stand-in rather than a fake that reports sizes: nothing in this
 * environment has a box to measure, so any number it invented would be a lie the tests
 * could come to depend on. Specs that need real geometry belong in the Playwright suite.
 */
class NoopResizeObserver implements ResizeObserver {
  observe(): void {
    // no layout to observe
  }
  unobserve(): void {
    // no layout to observe
  }
  disconnect(): void {
    // nothing was ever observed
  }
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = NoopResizeObserver;
}
