# Agent caveats

## No backticks inside CSS comments in `styles: [\`…\`]`

Angular components in this repo use the inline-styles form:

```ts
@Component({
  styles: [
    `
      .foo { … }
    `,
  ],
})
```

The styles array is a **JS template literal**. Any backtick inside it — even
inside a `/* CSS comment */` — closes the template literal early. Angular's
AOT analyzer then reports:

```
Error: FatalDiagnosticError: Code: 1010,
  Message: Failed to resolve styles at position 0 to a string
  Value could not be determined statically.
```

The error does **not** name the file. The Playwright `webServer` config
treats this as a startup hang and fails with
`Timed out waiting 180000ms from config.webServer.` — the AOT error is only
visible in the captured `[WebServer]` lines above the timeout.

If you see that combo, grep for backticks inside `styles: [` blocks:

```bash
# rough check — flags any backtick on a line that isn't the literal's open/close
awk '/styles: \[/,/^\s*\],?$/' src/app/**/*.ts | grep '`'
```

Don't reach for backticks to quote identifiers in CSS comments. Use plain
quotes, or just refer to the thing by name.

## `isomorphic-git`: pass a `cache`, and don't trust `log()`

Three traps, all of which we hit, all of which fail silently rather than loudly.

### Every call defaults `cache` to a fresh `{}`

The parsed pack index **and the packfile bytes** live in that cache. Calling
`walk()` once per commit without threading one object through every call means
each commit re-reads the whole `.pack` through `File.arrayBuffer()` *and*
re-computes SHA-1 over all of it (isomorphic-git verifies the packfile once per
cache, and a fresh cache is a fresh "once").

Measured on a 5.6 MB `.git`: 687 MB pulled through the blob reader with no
cache, 5.6 MB with one shared. It scales as `commits × packfile size`, so on a
real clone it is the difference between seconds and minutes.

One cache object lives for the lifetime of `git.worker.ts`. Pass it to every
call you add.

### `log()` returns a commit once per path that reaches it

It does not deduplicate across merge parents. A five-commit history with one
merge comes back as **seven** entries. That showed up as repeated rows in the
Git view, and — worse, because nothing looked wrong — as inflated churn counts.
Use `walkHistory()` in `git.worker.ts` instead; it is the same newest-first
frontier walk git uses, with a `seen` set.

### Diffing a merge against its first parent double-counts

A merge's tree differs from its first parent by everything the other branch
contributed, so "diff against `parent[0]`" counts every merged-in change a
second time. `git log -- <path>` reports one commit for such a file. Churn walks
*all* parents and counts a path only when it differs from every one of them.

### The fs adapter's `readdir` is pre-indexed — keep it that way

`readObjectPacked` calls `readdir('objects/pack')` on every object it can't find
loose, i.e. once per tree and blob read on a packed repo. Deriving the listing
by scanning the file map made the walk O(files × objects): 6.8M key comparisons
on a 300-commit toy repo. `makeGitFs` builds a directory→children Map up front.

## Measuring performance

`scripts/` carries a small harness for the thing this app is worst at: a real project.
The fixture under `e2e/fixtures-data/` is 18 files, so nothing in the e2e suite tells you
whether a change made loading a 3000-file repo faster or slower.

```bash
node scripts/gen-bench-project.mjs /tmp/bigproj 3000 105   # ~3000 files, ~324k LOC
npx ng serve --port 4321 --host 127.0.0.1 &                # the harness drives a running server
node scripts/bench.mjs before /tmp/bigproj                 # load pipeline + per-view layout
node scripts/bench-interaction.mjs before /tmp/bigproj     # frame times, typing, matrix at file level
```

Both print `label<TAB>metric<TAB>value`, so a before/after is a diff of two runs. Set
`CHROMIUM_PATH` only where Playwright cannot resolve its own browser (the Linux sandbox);
locally, leave it unset.

Two things worth knowing before you trust a number:

* **Always measure a baseline from the same machine, in the same session.** These are
  wall-clock numbers off a dev server, and they move a lot between machines. Stash your
  change, run the harness, restore, run it again.
* **`ng serve` is unoptimized**, so absolute values are pessimistic. The ratio is the
  signal; the absolute number is not.

The generated project has no `.git/`, so it exercises the analysis pipeline but not the
history walk. Point the harness at a real repo to measure churn.
