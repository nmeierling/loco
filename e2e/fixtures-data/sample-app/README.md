# sample-app

A fake storefront used as the end-to-end test corpus for loco.

It exists so the tests do not analyse loco's own `src/` folder — that corpus changes
with every commit, which quietly breaks assertions about tile counts, graph layout
and symbol usage. Everything here is deliberately stable: change it only when a test
needs a shape it does not already provide, and expect to update the specs that count
things when you do.

Shape the specs rely on:

- `app/core/services/catalog.service.ts` is the deep file (four levels down) used for
  AST, source-panel and auto-expand tests. It is also by far the largest file, which
  the list viz's minimum-value filter leans on.
- `app/core/state/catalog.store.ts` exports `CatalogStore`, the shared class the
  usages tests trace across the app.
- `app/app.scss` is the one file with no AST grammar.
- Three `*.component.ts` files back the name-filter and custom-ignore tests.
- `app/core/workers/indexer.worker.ts` is the only path containing "worker".
