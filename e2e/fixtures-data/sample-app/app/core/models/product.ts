export interface Product {
  id: string;
  name: string;
  category: string;
  priceCents: number;
  stock: number;
  tags: string[];
}

export interface CartLine {
  productId: string;
  quantity: number;
}

export type SortKey = 'name' | 'price' | 'stock';

export const EMPTY_PRODUCT: Product = {
  id: '',
  name: '',
  category: 'misc',
  priceCents: 0,
  stock: 0,
  tags: [],
};

export function isInStock(product: Product): boolean {
  return product.stock > 0;
}

export function totalStock(products: readonly Product[]): number {
  let total = 0;
  for (const product of products) total += product.stock;
  return total;
}
