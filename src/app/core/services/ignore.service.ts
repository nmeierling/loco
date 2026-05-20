import { Injectable, computed, signal } from '@angular/core';
import ignore, { Ignore } from 'ignore';

export interface IgnoreSection {
  id: string;
  label: string;
  description: string;
  patterns: readonly string[];
}

export const DEFAULT_IGNORE_SECTIONS: readonly IgnoreSection[] = [
  {
    id: 'vcs-and-build',
    label: 'VCS, builds & caches',
    description: 'Output directories and tool caches that aren’t source code.',
    patterns: [
      '.git/', '.svn/', '.hg/',
      'node_modules/', 'bower_components/', 'jspm_packages/',
      'dist/', 'build/', 'out/', 'output/', 'target/',
      '.next/', '.nuxt/', '.angular/', '.svelte-kit/', '.astro/', '.expo/',
      '.cache/', '.parcel-cache/', '.turbo/', '.vite/',
      'coverage/', '.nyc_output/',
    ],
  },
  {
    id: 'editor-and-os',
    label: 'Editor & OS files',
    description: 'IDE configs and OS junk.',
    patterns: [
      '.idea/', '.vscode/', '.vs/', '.fleet/', '.zed/',
      '.DS_Store', 'Thumbs.db', 'desktop.ini',
      '*.swp', '*.swo', '*.bak', '*.tmp', '*~',
    ],
  },
  {
    id: 'logs-and-secrets',
    label: 'Logs & local config',
    description: 'Logs and locally-scoped configs you usually don’t analyze.',
    patterns: [
      '*.log', '.env.local', '.env.*.local',
    ],
  },
  {
    id: 'js-ts',
    label: 'JavaScript / TypeScript',
    description: 'Lockfiles, generated bundles, source maps.',
    patterns: [
      'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb',
      '*.tsbuildinfo', '*.min.js', '*.min.css', '*.map',
    ],
  },
  {
    id: 'python',
    label: 'Python',
    description: 'Bytecode, virtualenvs, tool caches, lockfiles.',
    patterns: [
      '__pycache__/', '*.pyc', '*.pyo', '*.pyd',
      '.venv/', 'venv/', 'env/',
      '.tox/', '.pytest_cache/', '.mypy_cache/', '.ruff_cache/', '.pyre/',
      '.coverage', '*.egg-info/',
      'poetry.lock', 'Pipfile.lock', 'uv.lock',
    ],
  },
  {
    id: 'ruby',
    label: 'Ruby',
    description: 'Lockfile and bundler state.',
    patterns: ['Gemfile.lock', '.bundle/'],
  },
  {
    id: 'rust',
    label: 'Rust',
    description: 'Lockfile.',
    patterns: ['Cargo.lock'],
  },
  {
    id: 'go',
    label: 'Go',
    description: 'Module checksums.',
    patterns: ['go.sum'],
  },
  {
    id: 'php',
    label: 'PHP',
    description: 'Composer artifacts.',
    patterns: ['composer.lock', 'vendor/'],
  },
  {
    id: 'jvm',
    label: 'Java / Kotlin / Gradle',
    description: 'Compiled classes and build tool state.',
    patterns: ['*.class', '*.jar', '*.war', '.gradle/', '.mvn/'],
  },
  {
    id: 'swift',
    label: 'Swift / iOS',
    description: 'Xcode and SwiftPM state.',
    patterns: [
      'Package.resolved', '.swiftpm/', 'Pods/', 'Carthage/',
      '*.xcworkspace/', '*.xcodeproj/', '*.xcuserstate', 'xcuserdata/',
    ],
  },
  {
    id: 'dotnet',
    label: '.NET',
    description: 'Build artifacts and user files.',
    patterns: ['bin/', 'obj/', '*.dll', '*.pdb', '*.exe', '*.user'],
  },
  {
    id: 'native',
    label: 'Native compiled',
    description: 'Object files and shared libraries.',
    patterns: ['*.o', '*.a', '*.so', '*.dylib'],
  },
];

const ALL_DEFAULTS: readonly string[] = DEFAULT_IGNORE_SECTIONS.flatMap((s) => s.patterns);

@Injectable({ providedIn: 'root' })
export class IgnoreService {
  readonly sections = DEFAULT_IGNORE_SECTIONS;
  readonly defaults = ALL_DEFAULTS;

  private readonly _userPatterns = signal<readonly string[]>([]);
  readonly userPatterns = this._userPatterns.asReadonly();

  private readonly _gitignorePatterns = signal<readonly string[]>([]);
  readonly gitignorePatterns = this._gitignorePatterns.asReadonly();

  /** Ignore matcher built from defaults + .gitignore — used during analysis to skip files before LOC counting. */
  readonly analysisIgnore = computed<Ignore>(() => {
    const ig = ignore();
    ig.add([...ALL_DEFAULTS, ...this._gitignorePatterns()]);
    return ig;
  });

  /** Ignore matcher built only from user patterns — applied as a live filter on top of the already-loaded tree. */
  readonly userIgnore = computed<Ignore>(() => {
    const ig = ignore();
    const pats = this._userPatterns();
    if (pats.length > 0) ig.add([...pats]);
    return ig;
  });

  addUserPattern(pattern: string): void {
    const p = pattern.trim();
    if (!p) return;
    this._userPatterns.update((list) => (list.includes(p) ? list : [...list, p]));
  }

  removeUserPattern(pattern: string): void {
    this._userPatterns.update((list) => list.filter((p) => p !== pattern));
  }

  clearUserPatterns(): void {
    this._userPatterns.set([]);
  }

  setGitignorePatterns(patterns: readonly string[]): void {
    this._gitignorePatterns.set(patterns);
  }

  /** Tests whether `path` would be ignored by the user-only filter. */
  userIgnores(path: string): boolean {
    const pats = this._userPatterns();
    if (pats.length === 0) return false;
    return this.userIgnore().ignores(path);
  }
}
