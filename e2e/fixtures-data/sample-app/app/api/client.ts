import { Product } from '../core/models/product';
import { PRODUCTS_ROUTE, productRoute } from './routes';

export interface FetchOptions {
  signal?: AbortSignal;
}

export class ApiClient {
  constructor(private readonly baseUrl: string) {}

  async listProducts(options: FetchOptions = {}): Promise<Product[]> {
    const response = await fetch(`${this.baseUrl}${PRODUCTS_ROUTE}`, options);
    if (!response.ok) throw new Error(`list failed: ${response.status}`);
    return (await response.json()) as Product[];
  }

  async getProduct(id: string, options: FetchOptions = {}): Promise<Product | null> {
    const response = await fetch(`${this.baseUrl}${productRoute(id)}`, options);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`get failed: ${response.status}`);
    return (await response.json()) as Product;
  }
}
