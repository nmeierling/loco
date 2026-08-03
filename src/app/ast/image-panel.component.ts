import { ChangeDetectionStrategy, Component, computed, effect, input, signal } from '@angular/core';

/**
 * Renders an image file straight from its blob via an object URL, on a checkerboard so
 * transparency is visible. The URL is revoked when the file changes or the view is torn
 * down, so switching tabs never leaks blobs.
 */
@Component({
  selector: 'loco-image-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap">
      @if (url(); as u) {
        <img [src]="u" [alt]="name()" />
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        overflow: hidden;
      }
      .wrap {
        flex: 1;
        min-height: 0;
        overflow: auto;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        /* Checkerboard so transparent PNGs/SVGs read clearly. */
        background-color: var(--input-bg);
        background-image:
          linear-gradient(45deg, color-mix(in srgb, var(--fg) 8%, transparent) 25%, transparent 25%),
          linear-gradient(-45deg, color-mix(in srgb, var(--fg) 8%, transparent) 25%, transparent 25%),
          linear-gradient(45deg, transparent 75%, color-mix(in srgb, var(--fg) 8%, transparent) 75%),
          linear-gradient(-45deg, transparent 75%, color-mix(in srgb, var(--fg) 8%, transparent) 75%);
        background-size: 20px 20px;
        background-position:
          0 0,
          0 10px,
          10px -10px,
          -10px 0;
      }
      img {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.25);
        /* Keep pixel art crisp rather than blurred when scaled up. */
        image-rendering: pixelated;
      }
    `,
  ],
})
export class ImagePanelComponent {
  readonly file = input<File | null>(null);
  readonly name = computed(() => this.file()?.name ?? '');

  private readonly _url = signal<string | null>(null);
  readonly url = this._url.asReadonly();

  constructor() {
    effect((onCleanup) => {
      const f = this.file();
      if (!f) {
        this._url.set(null);
        return;
      }
      const u = URL.createObjectURL(f);
      this._url.set(u);
      onCleanup(() => URL.revokeObjectURL(u));
    });
  }
}
