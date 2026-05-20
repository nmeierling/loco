import { Injectable } from '@angular/core';

/**
 * Architecture placeholder for git churn (commits-per-file).
 *
 * Plan:
 *  - When a dropped folder includes `.git/`, parse pack files / commit log in-browser
 *    (isomorphic-git or a small custom reader) to count commits per path.
 *  - For GitHub integration (future), fetch commit history via the REST API.
 *  - For general git remotes (future), use a small server-side proxy.
 *
 * v1 returns null for all files; the metric is hidden until a provider attaches.
 */
@Injectable({ providedIn: 'root' })
export class GitChurnService {
  async churnByPath(): Promise<Map<string, number>> {
    return new Map();
  }
}
