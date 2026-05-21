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
