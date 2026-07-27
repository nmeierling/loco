import { Product, isInStock } from '../models/product';

export class InventoryService {
  private reserved = new Map<string, number>();

  canFulfil(product: Product, quantity: number): boolean {
    if (!isInStock(product)) return false;
    return product.stock - (this.reserved.get(product.id) ?? 0) >= quantity;
  }

  take(product: Product, quantity: number): void {
    this.reserved.set(product.id, (this.reserved.get(product.id) ?? 0) + quantity);
    product.stock -= quantity;
  }

  add(product: Product, quantity: number): void {
    product.stock += quantity;
  }

  release(product: Product): void {
    this.reserved.delete(product.id);
  }

  reservedFor(product: Product): number {
    return this.reserved.get(product.id) ?? 0;
  }
}
