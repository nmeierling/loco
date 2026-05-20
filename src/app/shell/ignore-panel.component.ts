import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IgnoreService } from '../core/services/ignore.service';
import { AnalysisStore } from '../core/state/analysis.store';

@Component({
  selector: 'loco-ignore-panel',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head">
      <h3>Ignore</h3>
      <span class="count">{{ totalCount() }}</span>
    </div>

    @if (selected(); as s) {
      <section class="block selected">
        <header class="block-head">
          <span class="block-title">Selected</span>
        </header>
        <div class="sel-path" [title]="s.path">{{ s.path }}</div>
        <div class="actions">
          <button class="action" (click)="ignoreFile(s.path)">Ignore file</button>
          @if (s.parent) {
            <button class="action" (click)="ignoreFolder(s.parent)" title="Ignore '{{ s.parent }}/'">
              Ignore folder
            </button>
          }
          @if (s.ext) {
            <button class="action" (click)="ignoreExt(s.ext)" title="Ignore '*.{{ s.ext }}'">
              Ignore *.{{ s.ext }}
            </button>
          }
        </div>
      </section>
    }

    <section class="block">
      <header class="block-head">
        <span class="block-title">Custom</span>
        <span class="muted">{{ userPatterns().length }}</span>
      </header>
      <form class="add" (submit)="onSubmitCustom($event)">
        <input
          class="input"
          type="text"
          placeholder="e.g. *.snap, src/legacy/"
          [ngModel]="draft()"
          (ngModelChange)="draft.set($event)"
          name="pattern"
        />
        <button class="add-btn" type="submit" [disabled]="!draft().trim()">Add</button>
      </form>
      @if (userPatterns().length === 0) {
        <p class="empty">No custom patterns yet. Click a tile to add one quickly.</p>
      } @else {
        <ul class="patterns">
          @for (p of userPatterns(); track p) {
            <li class="pattern">
              <code>{{ p }}</code>
              <button class="x" type="button" (click)="remove(p)" aria-label="Remove">×</button>
            </li>
          }
        </ul>
      }
    </section>

    @if (gitignore().length > 0) {
      <section class="block">
        <header class="block-head clickable" (click)="toggle('gitignore')">
          <span class="chev">{{ open()['gitignore'] ? '▾' : '▸' }}</span>
          <span class="block-title">From .gitignore</span>
          <span class="muted">{{ gitignore().length }}</span>
        </header>
        @if (open()['gitignore']) {
          <ul class="patterns ro">
            @for (p of gitignore(); track p) {
              <li class="pattern ro"><code>{{ p }}</code></li>
            }
          </ul>
        }
      </section>
    }

    @for (sec of sections; track sec.id) {
      <section class="block">
        <header class="block-head clickable" (click)="toggleSection(sec.id)">
          <span class="chev">{{ isOpen(sec.id) ? '▾' : '▸' }}</span>
          <span class="block-title">{{ sec.label }}</span>
          <span class="muted">{{ sec.patterns.length }}</span>
        </header>
        @if (isOpen(sec.id)) {
          <p class="desc">{{ sec.description }}</p>
          <ul class="patterns ro">
            @for (p of sec.patterns; track p) {
              <li class="pattern ro"><code>{{ p }}</code></li>
            }
          </ul>
        }
      </section>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
        overflow: auto;
        padding: 10px 12px 28px;
        font-size: 12px;
      }
      .head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        margin-bottom: 8px;
      }
      h3 {
        margin: 0;
        font-size: 13px;
        font-weight: 600;
      }
      .count {
        opacity: 0.55;
        font-size: 11px;
      }
      .block {
        border-top: 1px solid var(--border);
        padding: 8px 0;
      }
      .block.selected {
        border-top: none;
        background: color-mix(in srgb, var(--accent) 9%, transparent);
        padding: 8px 10px;
        border-radius: 5px;
        margin-bottom: 6px;
      }
      .block-head {
        display: flex;
        align-items: baseline;
        gap: 6px;
        margin-bottom: 6px;
      }
      .block-head.clickable {
        cursor: pointer;
        user-select: none;
      }
      .block-head.clickable:hover .block-title {
        color: var(--accent);
      }
      .block-title {
        font-weight: 600;
        flex: 1;
      }
      .muted {
        opacity: 0.55;
        font-size: 11px;
      }
      .chev {
        opacity: 0.55;
        font-size: 10px;
        width: 10px;
        text-align: center;
      }
      .desc {
        margin: 0 0 6px;
        font-size: 11px;
        opacity: 0.65;
      }
      .sel-path {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px;
        margin-bottom: 6px;
        word-break: break-all;
      }
      .actions {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
      }
      .action {
        border: 1px solid var(--border);
        background: var(--input-bg);
        color: inherit;
        padding: 3px 8px;
        font-size: 11px;
        border-radius: 3px;
        cursor: pointer;
        font-family: inherit;
      }
      .action:hover {
        background: var(--hover);
        border-color: var(--accent);
      }
      .add {
        display: flex;
        gap: 4px;
        margin-bottom: 6px;
      }
      .input {
        flex: 1;
        background: var(--input-bg);
        color: inherit;
        border: 1px solid var(--border);
        border-radius: 3px;
        padding: 3px 6px;
        font-size: 11px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .input:focus {
        outline: none;
        border-color: var(--accent);
      }
      .add-btn {
        background: var(--accent);
        color: var(--accent-fg);
        border: none;
        padding: 3px 10px;
        font-size: 11px;
        border-radius: 3px;
        cursor: pointer;
        font-family: inherit;
      }
      .add-btn:disabled {
        opacity: 0.5;
        cursor: default;
      }
      .empty {
        margin: 4px 0;
        opacity: 0.55;
        font-size: 11px;
      }
      .patterns {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .pattern {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 2px 0;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px;
      }
      .pattern code {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        background: transparent;
        padding: 0;
      }
      .pattern.ro code {
        opacity: 0.75;
      }
      .x {
        background: transparent;
        border: none;
        color: inherit;
        cursor: pointer;
        opacity: 0.5;
        font-size: 14px;
        line-height: 1;
        padding: 0 4px;
      }
      .x:hover {
        opacity: 1;
        color: var(--danger);
      }
    `,
  ],
})
export class IgnorePanelComponent {
  private readonly ig = inject(IgnoreService);
  private readonly store = inject(AnalysisStore);

  readonly sections = this.ig.sections;
  readonly userPatterns = this.ig.userPatterns;
  readonly gitignore = this.ig.gitignorePatterns;

  readonly totalCount = computed(
    () =>
      this.ig.defaults.length + this.gitignore().length + this.userPatterns().length,
  );

  readonly selected = computed(() => {
    const path = this.store.selectedPath();
    if (!path) return null;
    const lastSlash = path.lastIndexOf('/');
    const parent = lastSlash > 0 ? path.slice(0, lastSlash) : '';
    const base = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
    const dot = base.lastIndexOf('.');
    const ext = dot > 0 ? base.slice(dot + 1) : '';
    return { path, parent, ext };
  });

  readonly draft = signal('');

  readonly open = signal<Record<string, boolean>>({
    gitignore: true,
  });

  toggle(key: string): void {
    this.open.update((m) => ({ ...m, [key]: !m[key] }));
  }
  toggleSection(id: string): void {
    this.toggle(id);
  }
  isOpen(key: string): boolean {
    return Boolean(this.open()[key]);
  }

  onSubmitCustom(ev: Event): void {
    ev.preventDefault();
    const p = this.draft().trim();
    if (!p) return;
    this.ig.addUserPattern(p);
    this.draft.set('');
  }

  remove(p: string): void {
    this.ig.removeUserPattern(p);
  }

  ignoreFile(path: string): void {
    this.ig.addUserPattern(path);
  }
  ignoreFolder(parent: string): void {
    if (!parent) return;
    this.ig.addUserPattern(parent + '/');
  }
  ignoreExt(ext: string): void {
    this.ig.addUserPattern('*.' + ext);
  }
}
