export const PRODUCTS_ROUTE = '/api/products';
export const CART_ROUTE = '/api/cart';

export function productRoute(id: string): string {
  return `${PRODUCTS_ROUTE}/${encodeURIComponent(id)}`;
}

export function cartLineRoute(productId: string): string {
  return `${CART_ROUTE}/${encodeURIComponent(productId)}`;
}
