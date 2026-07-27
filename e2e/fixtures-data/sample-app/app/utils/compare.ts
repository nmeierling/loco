import { Product, SortKey } from '../core/models/product';

export function compareBy(key: SortKey): (a: Product, b: Product) => number {
  switch (key) {
    case 'price':
      return (a, b) => a.priceCents - b.priceCents;
    case 'stock':
      return (a, b) => a.stock - b.stock;
    default:
      return (a, b) => a.name.localeCompare(b.name);
  }
}

export function byIdAscending(a: Product, b: Product): number {
  return a.id.localeCompare(b.id);
}
