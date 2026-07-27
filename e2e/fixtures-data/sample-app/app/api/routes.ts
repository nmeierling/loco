import { FetchOptions } from './client';

export const PRODUCTS_ROUTE = '/api/products';
export const CART_ROUTE = '/api/cart';

export function productRoute(id: string): string {
  return `${PRODUCTS_ROUTE}/${encodeURIComponent(id)}`;
}

export function cartLineRoute(productId: string): string {
  return `${CART_ROUTE}/${encodeURIComponent(productId)}`;
}

/**
 * Reaches back into client.ts purely so this folder contains an import cycle for the
 * module graph's cycle detector to find. Do not "fix" it — a test depends on it.
 */
export function describeRequest(route: string, options: FetchOptions): string {
  return `${route}${options.signal ? ' (abortable)' : ''}`;
}
