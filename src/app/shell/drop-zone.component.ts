import { ChangeDetectionStrategy, Component, EventEmitter, Output, inject, signal } from '@angular/core';
import { DirectoryLoaderService, LoadResult } from '../core/services/directory-loader.service';

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
        @if (!hasFsApi) {
          <span class="hint">(via file dialog)</span>
        }
      </div>
      <input
        #fileInput
        type="file"
        webkitdirectory
        multiple
        hidden
        (change)="onInput($event)"
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
  readonly hasFsApi = this.loader.hasFsAccessApi();
  readonly dragOver = signal(false);

  @Output() loaded = new EventEmitter<LoadResult>();
  @Output() error = new EventEmitter<string>();

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
    try {
      const result = await this.loader.loadFromDrop(ev);
      if (result) this.loaded.emit(result);
      else this.error.emit('No directory found in the drop. Drop a folder, not files.');
    } catch (e) {
      this.error.emit(e instanceof Error ? e.message : 'Failed to load directory.');
    }
  }

  async openPicker(): Promise<void> {
    try {
      if (this.hasFsApi) {
        const result = await this.loader.pickDirectory();
        if (result) this.loaded.emit(result);
        return;
      }
      const input = document.querySelector<HTMLInputElement>('loco-drop-zone input[type="file"]');
      input?.click();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to open folder picker.';
      if (!/AbortError|user activation/i.test(msg)) this.error.emit(msg);
    }
  }

  async onInput(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const result = await this.loader.loadFromInput(input.files);
    this.loaded.emit(result);
    input.value = '';
  }
}
