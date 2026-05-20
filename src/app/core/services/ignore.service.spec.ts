import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { DEFAULT_IGNORE_SECTIONS, IgnoreService } from './ignore.service';

describe('IgnoreService', () => {
  let svc: IgnoreService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    svc = TestBed.inject(IgnoreService);
  });

  it('exposes language-aware default sections', () => {
    const labels = DEFAULT_IGNORE_SECTIONS.map((s) => s.label);
    expect(labels).toContain('VCS, builds & caches');
    expect(labels).toContain('JavaScript / TypeScript');
    expect(labels).toContain('Python');
    expect(labels).toContain('Swift / iOS');
  });

  it('flattens defaults including common lockfiles and cache dirs', () => {
    const ds = svc.defaults;
    expect(ds).toContain('node_modules/');
    expect(ds).toContain('package-lock.json');
    expect(ds).toContain('__pycache__/');
    expect(ds).toContain('Cargo.lock');
    expect(ds).toContain('composer.lock');
  });

  it('analysisIgnore matches default patterns and added .gitignore patterns', () => {
    svc.setGitignorePatterns(['build-output/']);
    const ig = svc.analysisIgnore();
    expect(ig.ignores('node_modules/foo/index.js')).toBe(true);
    expect(ig.ignores('package-lock.json')).toBe(true);
    expect(ig.ignores('build-output/x.js')).toBe(true);
    expect(ig.ignores('src/main.ts')).toBe(false);
  });

  it('userIgnores reflects added custom patterns, supports removal', () => {
    svc.addUserPattern('*.spec.ts');
    expect(svc.userIgnores('app/foo.spec.ts')).toBe(true);
    expect(svc.userIgnores('app/foo.ts')).toBe(false);

    svc.removeUserPattern('*.spec.ts');
    expect(svc.userIgnores('app/foo.spec.ts')).toBe(false);
  });

  it('userIgnores returns false when no custom patterns are present', () => {
    expect(svc.userIgnores('app/foo.spec.ts')).toBe(false);
  });
});
