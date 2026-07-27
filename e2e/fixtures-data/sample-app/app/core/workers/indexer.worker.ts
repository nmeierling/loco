import { Product } from '../models/product';

export interface IndexEntry {
  id: string;
  terms: string[];
}

/** The only path in the corpus containing "worker" — the list filter test relies on it. */
export function buildIndex(products: readonly Product[]): IndexEntry[] {
  return products.map((product) => ({
    id: product.id,
    terms: tokenize(`${product.name} ${product.category} ${product.tags.join(' ')}`),
  }));
}

export function lookup(index: readonly IndexEntry[], query: string): string[] {
  const terms = tokenize(query);
  if (terms.length === 0) return [];
  return index
    .filter((entry) => terms.every((t) => entry.terms.includes(t)))
    .map((entry) => entry.id);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}
