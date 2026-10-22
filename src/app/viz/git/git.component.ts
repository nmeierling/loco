import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { schemeTableau10 } from 'd3-scale-chromatic';
import { AnalysisStore } from '../../core/state/analysis.store';
import { TabsStore } from '../../core/state/tabs.store';
import {
  COMMIT_LIMITS,
  GitRepoService,
  type GitCommitDetail,
} from '../../core/services/git-repo.service';
import type { GitCommitWire, GitRefBadge } from '../../core/workers/git.worker';
import { formatSize } from '../../core/models/tree';
import { ViewSpinnerComponent } from '../../shell/view-spinner.component';
import { layoutGraph, type GraphEdge } from './git-graph';

/** Row pitch of the commit list. The lane SVG is absolutely positioned against it. */
const ROW_H = 30;
/** Horizontal pitch between lanes, and the left inset of lane 0. */
const LANE_W = 14;
const LANE_X0 = 11;
const DOT_R = 3.5;
/** Weeks of history the activity strip shows, most recent last. */
const ACTIVITY_WEEKS = 104;

interface Row {
  commit: GitCommitWire;
  lane: number;
  y: number;
  color: string;
  when: string;
  shortOid: string;
}

interface Segment {
  d: string;
  color: string;
}

interface SizeSlice {
  label: string;
  bytes: number;
  pct: number;
  color: string;
  detail: string;
}

/**
 * Repository view: what the `.git/` directory contains, and the newest slice of history
 * drawn as a lane graph.
 *
 * Everything here is read out of the dropped `.git/` by a worker (see
 * {@link GitRepoService}); there is no network access and no shelling out to `git`.
 */
@Component({
  selector: 'loco-git-view',
  standalone: true,
  imports: [ViewSpinnerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (state().status === 'unavailable') {
      <div class="empty">
        <p class="lead">No git history in this folder.</p>
        <p>
          The Git view reads the <code>.git/</code> directory out of the folder you dropped. Safari
          and Firefox strip hidden files from folder uploads, so use a Chromium-based browser
          (Chrome, Edge, Brave) and drop the folder that <em>contains</em> <code>.git/</code>.
        </p>
      </div>
    } @else if (state().status === 'error') {
      <div class="empty">
        <p class="lead">Could not read the git history.</p>
        <p class="mono">{{ errorMessage() }}</p>
        <button type="button" class="chip" (click)="repo.reload(limit())">Try again</button>
      </div>
    } @else {
      <div class="bar">
        @if (overview(); as o) {
          <span class="branch" [class.detached]="o.head.detached">
            {{ o.head.detached ? 'detached at ' + shortOid(o.head.oid) : (o.head.ref ?? 'HEAD') }}
          </span>
          <span class="count">{{ commitCountLabel() }}</span>
        }
        <span class="spacer"></span>
        <span class="count">show</span>
        @for (n of limits; track n) {
          <button type="button" class="chip" [class.active]="limit() === n" (click)="setLimit(n)">
            {{ n }}
          </button>
        }
      </div>

      <div class="body">
        <div class="graph-pane">
          @if (rows().length > 0) {
            <div class="list" [style.height.px]="rows().length * ROW_H">
              <svg
                class="lanes"
                [attr.width]="laneWidth()"
                [attr.height]="rows().length * ROW_H"
                aria-hidden="true"
              >
                @for (s of segments(); track $index) {
                  <path [attr.d]="s.d" [attr.stroke]="s.color" fill="none" stroke-width="1.6" />
                }
                @for (r of rows(); track r.commit.oid) {
                  <circle
                    [attr.cx]="laneX(r.lane)"
                    [attr.cy]="r.y + ROW_H / 2"
                    [attr.r]="r.commit.refs.length > 0 ? DOT_R + 1.2 : DOT_R"
                    [attr.fill]="r.color"
                    [attr.stroke]="r.commit.oid === selectedOid() ? 'currentColor' : 'none'"
                    stroke-width="1.5"
                  />
                }
              </svg>

              @for (r of rows(); track r.commit.oid) {
                <button
                  type="button"
                  class="row"
                  [class.selected]="r.commit.oid === selectedOid()"
                  [style.top.px]="r.y"
                  [style.height.px]="ROW_H"
                  [style.padding-left.px]="laneWidth() + 6"
                  (click)="select(r.commit.oid)"
                  [title]="r.commit.subject"
                >
                  @for (ref of r.commit.refs; track ref.name) {
                    <span class="ref" [class]="'ref-' + ref.kind">{{ refLabel(ref) }}</span>
                  }
                  <span class="subject">{{ r.commit.subject || '(no message)' }}</span>
                  <span class="author">{{ r.commit.author }}</span>
                  <span class="when">{{ r.when }}</span>
                  <span class="oid">{{ r.shortOid }}</span>
                </button>
              }
            </div>
          } @else if (state().status === 'ready') {
            <div class="empty"><p class="lead">This repository has no commits yet.</p></div>
          }
          @if (state().status === 'loading') {
            <loco-view-spinner label="Reading git history…" />
          }
        </div>

        <aside class="side">
          @if (selected(); as c) {
            <div class="panel">
              <div class="panel-head">
                <strong>{{ shortOid(c.oid) }}</strong>
                <button type="button" class="chip" (click)="select(null)">back to repo</button>
              </div>
              <p class="subject-full">{{ c.subject || '(no message)' }}</p>
              @if (c.body) {
                <pre class="body-text">{{ c.body }}</pre>
              }
              <dl class="kv">
                <dt>Author</dt>
                <dd>{{ c.author }} &lt;{{ c.email }}&gt;</dd>
                <dt>Date</dt>
                <dd>{{ fullDate(c.timestamp) }}</dd>
                <dt>Parents</dt>
                <dd class="mono parents">
                  @if (c.parents.length === 0) {
                    <span class="dim">root commit</span>
                  }
                  @for (p of c.parents; track p) {
                    <button type="button" class="link" (click)="select(p)">
                      {{ shortOid(p) }}
                    </button>
                  }
                </dd>
              </dl>

              <h4>
                Changed files
                @if (detail(); as d) {
                  <span class="count">{{ d.changes.length }}</span>
                }
              </h4>
              @if (detailLoading()) {
                <p class="dim">Diffing against the first parent…</p>
              } @else if (detail(); as d) {
                @if (d.merge) {
                  <p class="dim">Merge commit — shown against its first parent.</p>
                }
                @if (d.changes.length === 0) {
                  <p class="dim">No file changes.</p>
                }
                <ul class="changes">
                  @for (ch of d.changes; track ch.path) {
                    <li>
                      <span class="status" [class]="'st-' + ch.status">{{
                        statusChar(ch.status)
                      }}</span>
                      @if (isOpenable(ch.path)) {
                        <button type="button" class="link path" (click)="open(ch.path)">
                          {{ ch.path }}
                        </button>
                      } @else {
                        <span class="path dim">{{ ch.path }}</span>
                      }
                    </li>
                  }
                </ul>
              } @else if (detailError()) {
                <p class="dim">{{ detailError() }}</p>
              }
            </div>
          } @else if (overview(); as o) {
            <div class="panel">
              <h4>Repository</h4>
              <dl class="kv">
                <dt>HEAD</dt>
                <dd>{{ o.head.detached ? 'detached' : (o.head.ref ?? '—') }}</dd>
                <dt>Commits</dt>
                <dd>{{ commitCountLabel() }}</dd>
                <dt>Span</dt>
                <dd>{{ spanLabel() }}</dd>
                <dt>Branches</dt>
                <dd>{{ o.branches.length }} local · {{ o.remoteBranches.length }} remote</dd>
                <dt>Tags</dt>
                <dd>{{ o.tags.length }}</dd>
              </dl>

              <h4>
                <!-- One element, or the h4's flex layout strands " size" in the middle. -->
                <span><code>.git</code> size</span>
                <span class="count">{{ size(o.size.total) }}</span>
              </h4>
              <div class="stack" [attr.aria-label]="'.git size breakdown'">
                @for (s of sizeSlices(); track s.label) {
                  <span
                    class="slice"
                    [style.width.%]="s.pct"
                    [style.background]="s.color"
                    [title]="s.label + ': ' + s.detail"
                  ></span>
                }
              </div>
              <ul class="legend">
                @for (s of sizeSlices(); track s.label) {
                  <li>
                    <span class="swatch" [style.background]="s.color"></span>
                    <span class="legend-label">{{ s.label }}</span>
                    <span class="legend-val">{{ s.detail }}</span>
                  </li>
                }
              </ul>
              <p class="dim note">
                {{ o.size.fileCount }} files under <code>.git/</code>. Reflogs, the index and hooks
                are skipped on load — they are never read.
              </p>

              @if (activity().length > 1) {
                <h4>Commits per week</h4>
                <svg
                  class="spark"
                  [attr.viewBox]="'0 0 ' + activity().length * 4 + ' 30'"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  @for (a of activity(); track a.weekStart) {
                    <rect
                      [attr.x]="$index * 4"
                      [attr.y]="30 - a.h"
                      width="3"
                      [attr.height]="a.h"
                      [attr.fill]="'var(--accent)'"
                    />
                  }
                </svg>
                <p class="dim note">{{ activitySpan() }}</p>
              }

              @if (o.branches.length > 0) {
                <h4>
                  Local branches <span class="count">{{ o.branches.length }}</span>
                </h4>
                <ul class="refs">
                  @for (b of o.branches; track b) {
                    <li>
                      <span class="ref ref-branch" [class.ref-head]="b === o.head.ref">{{
                        b
                      }}</span>
                    </li>
                  }
                </ul>
              }
              @if (o.remoteBranches.length > 0) {
                <h4>
                  Remote branches <span class="count">{{ o.remoteBranches.length }}</span>
                </h4>
                <ul class="refs">
                  @for (b of o.remoteBranches; track b) {
                    <li>
                      <span class="ref ref-remote">{{ b }}</span>
                    </li>
                  }
                </ul>
              }
              @if (o.tags.length > 0) {
                <h4>
                  Tags <span class="count">{{ o.tags.length }}</span>
                </h4>
                <ul class="refs">
                  @for (t of o.tags; track t) {
                    <li>
                      <span class="ref ref-tag">{{ t }}</span>
                    </li>
                  }
                </ul>
              }
              @if (o.remotes.length > 0) {
                <h4>Remotes</h4>
                <ul class="refs">
                  @for (r of o.remotes; track r.name) {
                    <li class="mono remote-row">
                      <strong>{{ r.name }}</strong> {{ r.url }}
                    </li>
                  }
                </ul>
              }
              @if (o.authors.length > 0) {
                <h4>
                  Top authors
                  <span class="count">{{ o.authors.length }} total</span>
                </h4>
                <ul class="authors">
                  @for (a of topAuthors(); track a.email) {
                    <li>
                      <span class="legend-label" [title]="a.email">{{ a.name }}</span>
                      <span class="bar-wrap">
                        <span class="bar-fill" [style.width.%]="a.pct"></span>
                      </span>
                      <span class="legend-val">{{ a.commits }}</span>
                    </li>
                  }
                </ul>
              }
            </div>
          }
        </aside>
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
      }
      .bar {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        border-bottom: 1px solid var(--border);
        flex-shrink: 0;
      }
      .branch {
        font-size: 12px;
        font-weight: 600;
        padding: 2px 8px;
        border-radius: 10px;
        background: var(--accent);
        color: var(--accent-fg);
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .branch.detached {
        background: var(--danger);
      }
      .spacer {
        flex: 1;
      }
      .count {
        font-size: 11px;
        opacity: 0.7;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .chip {
        border: 1px solid var(--border);
        background: transparent;
        color: inherit;
        padding: 3px 8px;
        border-radius: 3px;
        font-size: 11px;
        cursor: pointer;
        font-family: inherit;
      }
      .chip.active {
        background: var(--accent);
        color: var(--accent-fg);
        border-color: var(--accent);
      }
      .chip:hover:not(.active) {
        background: var(--hover);
      }

      .body {
        display: flex;
        flex: 1;
        min-height: 0;
      }
      .graph-pane {
        position: relative;
        flex: 1;
        min-width: 0;
        overflow: auto;
      }
      .side {
        width: 320px;
        flex-shrink: 0;
        border-left: 1px solid var(--border);
        overflow: auto;
        background: var(--bar-bg);
      }
      .panel {
        padding: 10px 12px 20px;
      }
      .panel-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
      }

      .list {
        position: relative;
      }
      .lanes {
        position: absolute;
        top: 0;
        left: 0;
        pointer-events: none;
        color: var(--fg);
      }
      .row {
        position: absolute;
        left: 0;
        right: 0;
        display: flex;
        align-items: center;
        gap: 8px;
        padding-right: 10px;
        border: none;
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
        min-width: 0;
      }
      .row:hover {
        background: var(--hover);
      }
      .row.selected {
        background: color-mix(in srgb, var(--accent) 16%, transparent);
      }
      .subject {
        flex: 1;
        min-width: 0;
        font-size: 12.5px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .author {
        font-size: 11px;
        opacity: 0.7;
        flex-shrink: 0;
        max-width: 140px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .when {
        font-size: 11px;
        opacity: 0.6;
        flex-shrink: 0;
        width: 86px;
        text-align: right;
      }
      .oid {
        font-size: 11px;
        opacity: 0.55;
        flex-shrink: 0;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }

      .ref {
        flex-shrink: 0;
        font-size: 10.5px;
        padding: 1px 6px;
        border-radius: 9px;
        border: 1px solid var(--border-strong);
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        white-space: nowrap;
        max-width: 180px;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .ref-head {
        background: var(--accent);
        color: var(--accent-fg);
        border-color: var(--accent);
        font-weight: 600;
      }
      .ref-branch {
        background: color-mix(in srgb, var(--accent) 18%, transparent);
      }
      .ref-remote {
        opacity: 0.75;
      }
      .ref-tag {
        background: color-mix(in srgb, var(--danger) 18%, transparent);
        border-color: color-mix(in srgb, var(--danger) 55%, transparent);
      }

      h4 {
        margin: 16px 0 6px;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        opacity: 0.68;
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
      }
      h4:first-child {
        margin-top: 2px;
      }
      .kv {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 2px 10px;
        margin: 0;
        font-size: 12px;
      }
      .kv dt {
        opacity: 0.6;
      }
      .kv dd {
        margin: 0;
        min-width: 0;
        overflow-wrap: anywhere;
      }
      /* A merge has several parents; without this they read as one long hash. */
      .parents {
        display: flex;
        flex-wrap: wrap;
        gap: 2px 8px;
      }
      .subject-full {
        font-size: 13px;
        font-weight: 500;
        margin: 8px 0;
      }
      .body-text {
        font-size: 11.5px;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        margin: 0 0 10px;
        opacity: 0.8;
        max-height: 160px;
        overflow: auto;
      }

      .stack {
        display: flex;
        height: 10px;
        border-radius: 5px;
        overflow: hidden;
        background: var(--hover);
      }
      .slice {
        display: block;
        height: 100%;
      }
      .legend,
      .refs,
      .authors,
      .changes {
        list-style: none;
        margin: 6px 0 0;
        padding: 0;
        font-size: 11.5px;
      }
      .legend li,
      .authors li {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 1px 0;
      }
      .swatch {
        width: 9px;
        height: 9px;
        border-radius: 2px;
        flex-shrink: 0;
      }
      .legend-label {
        flex: 1;
        min-width: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .legend-val {
        opacity: 0.65;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        flex-shrink: 0;
      }
      .bar-wrap {
        width: 70px;
        height: 6px;
        border-radius: 3px;
        background: var(--hover);
        flex-shrink: 0;
        overflow: hidden;
      }
      .bar-fill {
        display: block;
        height: 100%;
        background: var(--accent);
      }
      .refs li {
        padding: 1px 0;
      }
      .remote-row {
        overflow-wrap: anywhere;
        font-size: 11px;
      }
      .spark {
        width: 100%;
        height: 34px;
        display: block;
      }

      .changes li {
        display: flex;
        align-items: baseline;
        gap: 6px;
        padding: 1px 0;
      }
      .status {
        width: 1em;
        flex-shrink: 0;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-weight: 600;
      }
      .st-added {
        color: var(--accent);
      }
      .st-deleted {
        color: var(--danger);
      }
      .st-modified {
        opacity: 0.7;
      }
      .path {
        min-width: 0;
        overflow-wrap: anywhere;
        text-align: left;
      }
      .link {
        background: none;
        border: none;
        padding: 0;
        margin: 0;
        color: var(--accent);
        font: inherit;
        cursor: pointer;
        text-decoration: underline;
        text-decoration-style: dotted;
      }
      .mono {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .dim {
        opacity: 0.6;
      }
      .note {
        font-size: 11px;
        margin: 6px 0 0;
      }

      .empty {
        padding: 24px;
        max-width: 56ch;
        font-size: 12.5px;
        line-height: 1.5;
      }
      .empty .lead {
        font-size: 14px;
        font-weight: 500;
        margin: 0 0 8px;
      }
      code {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
    `,
  ],
})
export class GitViewComponent {
  protected readonly repo = inject(GitRepoService);
  private readonly store = inject(AnalysisStore);
  private readonly tabs = inject(TabsStore);

  protected readonly ROW_H = ROW_H;
  protected readonly DOT_R = DOT_R;
  protected readonly limits = COMMIT_LIMITS;

  protected readonly state = this.repo.state;
  protected readonly limit = signal<number>(COMMIT_LIMITS[0]);
  protected readonly selectedOid = signal<string | null>(null);
  protected readonly detail = signal<GitCommitDetail | null>(null);
  protected readonly detailLoading = signal(false);
  protected readonly detailError = signal<string | null>(null);

  constructor() {
    // Fetching is keyed off the project, so switching away and back is free. The limit
    // is read untracked — `setLimit` does its own fetch, and a limit change shouldn't
    // look like a new project and drop the user's selected commit.
    effect(() => {
      this.store.projectId();
      this.selectedOid.set(null);
      this.repo.ensureLoaded(untracked(() => this.limit()));
    });

    effect(() => {
      const oid = this.selectedOid();
      this.detail.set(null);
      this.detailError.set(null);
      if (!oid) {
        this.detailLoading.set(false);
        return;
      }
      this.detailLoading.set(true);
      this.repo
        .detail(oid)
        .then((d) => {
          // A different commit may have been clicked while this one was diffing.
          if (this.selectedOid() !== oid) return;
          this.detail.set(d);
          this.detailLoading.set(false);
        })
        .catch((e: unknown) => {
          if (this.selectedOid() !== oid) return;
          this.detailError.set(e instanceof Error ? e.message : 'Could not diff this commit.');
          this.detailLoading.set(false);
        });
    });
  }

  protected readonly overview = computed(() => {
    const s = this.state();
    return s.status === 'ready' ? s.overview : null;
  });

  protected readonly errorMessage = computed(() => {
    const s = this.state();
    return s.status === 'error' ? s.message : '';
  });

  private readonly graph = computed(() => {
    const o = this.overview();
    if (!o) return null;
    return layoutGraph(o.commits.map((c) => ({ oid: c.oid, parents: c.parents })));
  });

  protected readonly rows = computed<Row[]>(() => {
    const o = this.overview();
    const g = this.graph();
    if (!o || !g) return [];
    const now = Date.now() / 1000;
    return o.commits.map((commit, i) => {
      const lane = g.rows[i]?.lane ?? 0;
      return {
        commit,
        lane,
        y: i * ROW_H,
        color: laneColor(lane),
        when: relativeTime(commit.timestamp, now),
        shortOid: commit.oid.slice(0, 7),
      };
    });
  });

  protected readonly laneWidth = computed(() => {
    const g = this.graph();
    const lanes = Math.max(1, g?.laneCount ?? 1);
    return LANE_X0 + (lanes - 1) * LANE_W + LANE_X0;
  });

  /** One SVG path per lane segment, including the stubs for history past the window. */
  protected readonly segments = computed<Segment[]>(() => {
    const g = this.graph();
    if (!g) return [];
    const out: Segment[] = [];
    for (let i = 0; i < g.gaps.length; i++) {
      const top = i * ROW_H + ROW_H / 2;
      const bottom = (i + 1) * ROW_H + ROW_H / 2;
      for (const edge of g.gaps[i]!)
        out.push({ d: edgePath(edge, top, bottom), color: laneColor(edge.lane) });
    }
    const lastTop = (g.rows.length - 1) * ROW_H + ROW_H / 2;
    for (const lane of g.trailing) {
      const x = this.laneX(lane);
      out.push({
        d: `M ${x} ${lastTop} L ${x} ${lastTop + ROW_H / 2}`,
        color: laneColor(lane),
      });
    }
    return out;
  });

  protected readonly selected = computed(() => {
    const oid = this.selectedOid();
    if (!oid) return null;
    return this.overview()?.commits.find((c) => c.oid === oid) ?? null;
  });

  protected readonly commitCountLabel = computed(() => {
    const o = this.overview();
    if (!o) return '';
    const n = o.commitCount.toLocaleString();
    return o.commitCountCapped ? `${n}+ commits` : `${n} commits`;
  });

  protected readonly spanLabel = computed(() => {
    const o = this.overview();
    if (!o || o.firstCommit === null || o.lastCommit === null) return '—';
    const fmt = (ts: number) =>
      new Date(ts * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
    const first = fmt(o.firstCommit);
    const last = fmt(o.lastCommit);
    return first === last ? first : `${first} – ${last}`;
  });

  protected readonly sizeSlices = computed<SizeSlice[]>(() => {
    const o = this.overview();
    if (!o) return [];
    const s = o.size;
    const parts = [
      { label: 'Packfiles', bytes: s.packs, detail: `${formatSize(s.packs)} · ${s.packCount}` },
      { label: 'Pack indexes', bytes: s.packIndexes, detail: formatSize(s.packIndexes) },
      {
        label: 'Loose objects',
        bytes: s.looseObjects,
        detail: `${formatSize(s.looseObjects)} · ${s.looseCount.toLocaleString()}`,
      },
      { label: 'Refs', bytes: s.refs, detail: formatSize(s.refs) },
      { label: 'Other', bytes: s.other, detail: formatSize(s.other) },
    ].filter((p) => p.bytes > 0);
    const total = parts.reduce((sum, p) => sum + p.bytes, 0) || 1;
    return parts.map((p, i) => ({
      ...p,
      pct: (p.bytes / total) * 100,
      color: laneColor(i),
    }));
  });

  protected readonly activity = computed(() => {
    const o = this.overview();
    if (!o) return [];
    // A decade of weekly bars in a 320px panel is a smear. Showing the recent window
    // keeps each bar a bar; the caption says which window it is.
    const window = o.activity.slice(-ACTIVITY_WEEKS);
    const max = Math.max(1, ...window.map((a) => a.commits));
    return window.map((a) => ({
      ...a,
      // A quiet week gets no bar at all, not a 1px one that reads as activity.
      h: a.commits === 0 ? 0 : Math.max(1, Math.round((a.commits / max) * 30)),
    }));
  });

  protected readonly activitySpan = computed(() => {
    const a = this.activity();
    const first = a[0];
    const last = a[a.length - 1];
    if (!first || !last) return '';
    const fmt = (ts: number) =>
      new Date(ts * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
    const active = a.filter((w) => w.commits > 0).length;
    return `${a.length} weeks (${active} active), ${fmt(first.weekStart)} – ${fmt(last.weekStart)}`;
  });

  protected readonly topAuthors = computed(() => {
    const o = this.overview();
    if (!o) return [];
    const top = o.authors.slice(0, 8);
    const max = Math.max(1, ...top.map((a) => a.commits));
    return top.map((a) => ({ ...a, pct: (a.commits / max) * 100 }));
  });

  protected laneX(lane: number): number {
    return LANE_X0 + lane * LANE_W;
  }

  protected setLimit(n: number): void {
    this.limit.set(n);
    this.repo.ensureLoaded(n);
  }

  protected select(oid: string | null): void {
    this.selectedOid.set(oid);
  }

  protected shortOid(oid: string | null): string {
    return oid ? oid.slice(0, 7) : '—';
  }

  protected refLabel(ref: GitRefBadge): string {
    return ref.kind === 'tag' ? `⌾ ${ref.name}` : ref.name;
  }

  protected statusChar(status: string): string {
    return status === 'added' ? 'A' : status === 'deleted' ? 'D' : 'M';
  }

  protected fullDate(ts: number): string {
    return new Date(ts * 1000).toLocaleString();
  }

  protected size(bytes: number): string {
    return formatSize(bytes);
  }

  /** A changed path is clickable only if that file survived the analysis filters. */
  protected isOpenable(path: string): boolean {
    return this.store.fileBlobs().has(path);
  }

  protected open(path: string): void {
    if (this.isOpenable(path)) this.tabs.openFile(path);
  }
}

function laneColor(lane: number): string {
  return schemeTableau10[lane % schemeTableau10.length]!;
}

/**
 * A lane segment. Straight down when it stays in its column; an S-curve when it moves,
 * which is what keeps a busy graph readable instead of a lattice of diagonals.
 */
function edgePath(edge: GraphEdge, top: number, bottom: number): string {
  const x1 = LANE_X0 + edge.fromLane * LANE_W;
  const x2 = LANE_X0 + edge.toLane * LANE_W;
  if (x1 === x2) return `M ${x1} ${top} L ${x1} ${bottom}`;
  const mid = (top + bottom) / 2;
  return `M ${x1} ${top} C ${x1} ${mid} ${x2} ${mid} ${x2} ${bottom}`;
}

function relativeTime(ts: number, nowSeconds: number): string {
  const diff = Math.max(0, nowSeconds - ts);
  const mins = Math.floor(diff / 60);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 31) return `${days}d ago`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(days / 365.25)}y ago`;
}
