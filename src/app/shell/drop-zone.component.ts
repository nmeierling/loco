import { ChangeDetectionStrategy, Component, EventEmitter, Output, inject, signal } from '@angular/core';
import { DirectoryLoaderService, LoadResult } from '../core/services/directory-loader.service';

/** Yields to the browser long enough that the next paint actually flushes pending DOM changes. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

@Component({
  selector: 'loco-drop-zone',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="zone"
      [class.over]="dragOver()"
      (dragenter)="onDragEnter($event)"
      (dragover)="onDragOver($event)"
      (dragleave)="onDragLeave($event)"
      (drop)="onDrop($event)"
    >
      <div class="title">drop a folder here</div>
      <div class="sub">
        or
        <button type="button" class="link" (click)="openPicker()">choose a folder</button>
      </div>
      <input
        #fileInput
        type="file"
        webkitdirectory
        multiple
        hidden
        (change)="onInput($event)"
        (cancel)="onPickerCanceled()"
      />
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .zone {
        border: 2px dashed var(--border-strong);
        border-radius: 8px;
        padding: 36px 16px;
        text-align: center;
        background: var(--zone-bg);
        transition: background 0.15s, border-color 0.15s;
      }
      .zone.over {
        border-color: var(--accent);
        background: var(--zone-bg-active);
      }
      .title {
        font-size: 15px;
        font-weight: 500;
        margin-bottom: 4px;
      }
      .sub {
        font-size: 12px;
        opacity: 0.75;
      }
      .link {
        background: none;
        border: none;
        color: var(--accent);
        text-decoration: underline;
        cursor: pointer;
        padding: 0;
        font: inherit;
      }
      .hint {
        opacity: 0.55;
        margin-left: 4px;
      }
    `,
  ],
})
export class DropZoneComponent {
  private readonly loader = inject(DirectoryLoaderService);
  readonly dragOver = signal(false);
  /** True while a picker dialog is open via this component, so onInput knows the started event already fired. */
  private pickerInFlight = false;

  @Output() loaded = new EventEmitter<LoadResult>();
  @Output() error = new EventEmitter<string>();
  @Output() started = new EventEmitter<void>();
  @Output() progress = new EventEmitter<number>();
  @Output() canceled = new EventEmitter<void>();

  onDragEnter(ev: DragEvent): void {
    ev.preventDefault();
    this.dragOver.set(true);
  }
  onDragOver(ev: DragEvent): void {
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
  }
  onDragLeave(ev: DragEvent): void {
    ev.preventDefault();
    this.dragOver.set(false);
  }

  async onDrop(ev: DragEvent): Promise<void> {
    ev.preventDefault();
    this.dragOver.set(false);
    this.started.emit();
    // Kick off the load synchronously so the user-activation context from the drop event
    // reaches getAsFileSystemHandle() before any await consumes it.
    const loadPromise = this.loader.loadFromDrop(ev, (n) => this.progress.emit(n));
    // Now safe to yield a paint frame so the spinner actually flushes to the screen.
    await nextPaint();
    try {
      const result = await loadPromise;
      if (result) this.loaded.emit(result);
      else {
        this.canceled.emit();
        this.error.emit('No directory found in the drop. Drop a folder, not files.');
      }
    } catch (e) {
      this.canceled.emit();
      this.error.emit(e instanceof Error ? e.message : 'Failed to load directory.');
    }
  }

  async openPicker(): Promise<void> {
    // Always use the webkitdirectory <input>. We deliberately avoid showDirectoryPicker
    // here: in Chromium its directory iterator silently strips dotfiles
    // (see https://github.com/whatwg/fs/issues/74), which means dropped repos would
    // be missing .git/, .gitignore, .env, .eslintrc, etc. The legacy <input> picker
    // includes hidden files.
    this.pickerInFlight = true;
    this.started.emit();
    const input = document.querySelector<HTMLInputElement>('loco-drop-zone input[type="file"]');
    input?.click();
  }

  async onInput(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const startedAlready = this.pickerInFlight;
    this.pickerInFlight = false;
    if (!input.files || input.files.length === 0) {
      this.canceled.emit();
      return;
    }
    if (!startedAlready) {
      this.started.emit();
      await nextPaint();
    }
    const result = await this.loader.loadFromInput(input.files, (n) => this.progress.emit(n));
    this.loaded.emit(result);
    input.value = '';
  }

  onPickerCanceled(): void {
    if (!this.pickerInFlight) return;
    this.pickerInFlight = false;
    this.canceled.emit();
  }
}
