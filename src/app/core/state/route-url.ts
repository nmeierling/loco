import { inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map, startWith } from 'rxjs/operators';

/**
 * A signal that tracks the current router URL — emits whenever navigation finishes,
 * starting with the initial URL the router has at component-construction time.
 */
export function routeUrlSignal() {
  const router = inject(Router);
  return toSignal(
    router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
      startWith(router.url),
    ),
    { initialValue: router.url },
  );
}
