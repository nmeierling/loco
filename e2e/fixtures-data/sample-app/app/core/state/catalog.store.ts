import { CartLine, Product } from '../models/product';

/**
 * The shared state every screen talks to. The usages tests trace this class and its
 * members across the app, so keep it imported from several places.
 */
export class CatalogStore {
  private products: Product[] = [];
  private lines: CartLine[] = [];

  selectedId: string | null = null;
  query = '';
  category: string | null = null;

  setProducts(products: readonly Product[]): void {
    this.products = [...products];
  }

  allProducts(): readonly Product[] {
    return this.products;
  }

  /** The method the usages tests follow — called from several screens. */
  selectProduct(id: string | null): void {
    this.selectedId = id;
  }

  selected(): Product | null {
    if (this.selectedId === null) return null;
    return this.products.find((p) => p.id === this.selectedId) ?? null;
  }

  setQuery(query: string): void {
    this.query = query;
  }

  setCategory(category: string | null): void {
    this.category = category;
  }

  visibleProducts(): Product[] {
    const needle = this.query.trim().toLowerCase();
    return this.products.filter((product) => {
      if (this.category && product.category !== this.category) return false;
      if (!needle) return true;
      return product.name.toLowerCase().includes(needle);
    });
  }

  addLine(productId: string, quantity: number): void {
    const existing = this.lines.find((l) => l.productId === productId);
    if (existing) {
      existing.quantity += quantity;
      return;
    }
    this.lines.push({ productId, quantity });
  }

  removeLine(productId: string): void {
    this.lines = this.lines.filter((l) => l.productId !== productId);
  }

  cartLines(): readonly CartLine[] {
    return this.lines;
  }

  reset(): void {
    this.products = [];
    this.lines = [];
    this.selectedId = null;
    this.query = '';
    this.category = null;
  }
}
