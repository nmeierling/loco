import { describe, expect, it } from 'vitest';
import { NameInput, clusterNames, domainTerms, groupNames, tokenize } from './domain-clustering';

function name(id: string, n: string, extra: Partial<NameInput> = {}): NameInput {
  return { id, name: n, path: `src/${id}.ts`, kind: 'class', exported: true, ...extra };
}

describe('tokenize', () => {
  it('splits camelCase and PascalCase', () => {
    expect(tokenize('UserProfileCard')).toEqual(['user', 'profile', 'card']);
  });

  it('keeps acronym runs together but splits the trailing word', () => {
    expect(tokenize('HTTPServerConfig')).toEqual(['http', 'server', 'config']);
    expect(tokenize('parseJSONResponse')).toEqual(['parse', 'json', 'response']);
  });

  it('handles snake_case, kebab-case and dotted names', () => {
    expect(tokenize('order_line_item')).toEqual(['order', 'line', 'item']);
    expect(tokenize('payment-gateway')).toEqual(['payment', 'gateway']);
    expect(tokenize('user.profile.view')).toEqual(['user', 'profile', 'view']);
  });
});

describe('domainTerms', () => {
  it('strips role/glue suffixes and short or numeric tokens', () => {
    expect(domainTerms('UserService')).toEqual(['user']);
    expect(domainTerms('OrderRepository')).toEqual(['order']);
    expect(domainTerms('getUserById')).toEqual(['user']); // get, by, id all dropped
    expect(domainTerms('V2Api')).toEqual([]); // v2 numeric-ish + api role
  });

  it('de-duplicates repeated terms', () => {
    expect(domainTerms('UserUserModel')).toEqual(['user']);
  });
});

describe('clusterNames', () => {
  it('groups names by their shared significant term', () => {
    const names = [
      name('a', 'UserCard'),
      name('b', 'UserService'),
      name('c', 'UserProfile'),
      name('d', 'OrderCart'),
      name('e', 'OrderRepository'),
      name('f', 'PaymentGateway'),
    ];
    const { clusters } = clusterNames(names, { minClusterSize: 2, minSupport: 2 });
    const byTitle = new Map(clusters.map((c) => [c.title, c.members.map((m) => m.name).sort()]));
    expect(byTitle.get('User')).toEqual(['UserCard', 'UserProfile', 'UserService']);
    expect(byTitle.get('Order')).toEqual(['OrderCart', 'OrderRepository']);
    // Payment appears once -> below support -> not its own domain.
    expect(byTitle.has('Payment')).toBe(false);
  });

  it('sends names below the support threshold to unassigned', () => {
    const names = [name('a', 'LoggerUtil'), name('b', 'DateHelper'), name('c', 'UuidFactory')];
    const { clusters, unassigned } = clusterNames(names);
    expect(clusters).toHaveLength(0);
    expect(unassigned.map((n) => n.name).sort()).toEqual(['DateHelper', 'LoggerUtil', 'UuidFactory']);
  });

  it('assigns a name to its highest-support term on a tie of membership', () => {
    // "user" appears in 3 names, "account" in 2; UserAccountView should land in User.
    const names = [
      name('a', 'UserView'),
      name('b', 'UserForm'),
      name('c', 'AccountBalance'),
      name('d', 'AccountSettings'),
      name('e', 'UserAccountView'),
    ];
    const { clusters } = clusterNames(names, { minSupport: 2, minClusterSize: 2 });
    const user = clusters.find((c) => c.title === 'User');
    expect(user?.members.map((m) => m.name)).toContain('UserAccountView');
  });

  it('respects the domain cap, spilling the smallest clusters to unassigned', () => {
    // Three same-size domains (user/order/stock), each with unique suffixes so only the
    // prefix term clusters. With maxDomains: 2 the third (alphabetically last) spills.
    const names = [
      name('a', 'UserCard'),
      name('b', 'UserForm'),
      name('c', 'OrderList'),
      name('d', 'OrderQueue'),
      name('e', 'StockLevel'),
      name('f', 'StockBadge'),
    ];
    const { clusters, unassigned } = clusterNames(names, { maxDomains: 2, minSupport: 2, minClusterSize: 2 });
    expect(clusters).toHaveLength(2);
    expect(unassigned).toHaveLength(2); // the third domain's members spill over
  });

  it('is deterministic across runs', () => {
    const names = [name('a', 'UserCard'), name('b', 'UserService'), name('c', 'OrderCart'), name('d', 'OrderRepo')];
    const first = JSON.stringify(clusterNames(names));
    const second = JSON.stringify(clusterNames(names));
    expect(first).toEqual(second);
  });
});

describe('groupNames: compound strategy', () => {
  it('splits a domain into a "primary · secondary" sub-domain where names justify it', () => {
    const names = [
      name('a', 'UserProfileCard'),
      name('b', 'UserProfileForm'),
      name('c', 'UserProfileView'),
      name('d', 'UserLogin'),
      name('e', 'UserLogout'),
    ];
    const { clusters } = groupNames(names, 'compound', { minSupport: 2, minClusterSize: 2 });
    const titles = clusters.map((c) => c.title).sort();
    expect(titles).toContain('User · Profile');
    // The login/logout names have no strong shared secondary, so they stay under User.
    expect(titles).toContain('User');
    const profile = clusters.find((c) => c.title === 'User · Profile');
    expect(profile?.members.map((m) => m.name).sort()).toEqual([
      'UserProfileCard',
      'UserProfileForm',
      'UserProfileView',
    ]);
  });
});

describe('groupNames: folder strategy', () => {
  it('groups names by their source directory', () => {
    const names = [
      { ...name('a', 'Cart'), path: 'src/order/cart.ts' },
      { ...name('b', 'Checkout'), path: 'src/order/checkout.ts' },
      { ...name('c', 'Invoice'), path: 'src/billing/invoice.ts' },
    ];
    const { clusters } = groupNames(names, 'folder');
    const byTitle = new Map(clusters.map((c) => [c.title, c.members.map((m) => m.name).sort()]));
    expect(byTitle.get('order')).toEqual(['Cart', 'Checkout']);
    expect(byTitle.get('billing')).toEqual(['Invoice']);
  });
});
