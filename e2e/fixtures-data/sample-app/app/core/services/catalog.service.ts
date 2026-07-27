import { CatalogStore } from '../state/catalog.store';
import { Product, SortKey, isInStock, totalStock } from '../models/product';
import { PricingService } from './pricing.service';
import { InventoryService } from './inventory.service';
import { compareBy } from '../../utils/compare';
import { formatMoney } from '../../utils/format';

export interface CatalogPage {
  items: Product[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CatalogSummary {
  count: number;
  stock: number;
  cheapest: string;
  dearest: string;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 200;

/**
 * The deep, long file. AST, source-panel and auto-expand specs open this one, and it
 * is deliberately the only file in the corpus over 200 lines.
 */
export class CatalogService {
  private cache = new Map<string, Product[]>();
  private lastError: string | null = null;

  constructor(
    private readonly store: CatalogStore,
    private readonly pricing: PricingService,
    private readonly inventory: InventoryService,
  ) {}

  load(products: readonly Product[]): void {
    this.store.setProducts(products);
    this.cache.clear();
    this.lastError = null;
  }

  page(pageNumber: number, pageSize = DEFAULT_PAGE_SIZE): CatalogPage {
    const size = Math.min(Math.max(1, pageSize), MAX_PAGE_SIZE);
    const all = this.store.visibleProducts();
    const start = Math.max(0, pageNumber) * size;
    return {
      items: all.slice(start, start + size),
      page: pageNumber,
      pageSize: size,
      total: all.length,
    };
  }

  sorted(key: SortKey, descending = false): Product[] {
    const items = [...this.store.visibleProducts()];
    items.sort(compareBy(key));
    if (descending) items.reverse();
    return items;
  }

  byCategory(category: string): Product[] {
    const cached = this.cache.get(category);
    if (cached) return cached;
    const items = this.store.allProducts().filter((p) => p.category === category);
    this.cache.set(category, items);
    return items;
  }

  categories(): string[] {
    const names = new Set<string>();
    for (const product of this.store.allProducts()) names.add(product.category);
    return [...names].sort();
  }

  search(query: string): Product[] {
    this.store.setQuery(query);
    return this.store.visibleProducts();
  }

  focus(id: string): Product | null {
    this.store.selectProduct(id);
    return this.store.selected();
  }

  clearFocus(): void {
    this.store.selectProduct(null);
  }

  available(): Product[] {
    return this.store.allProducts().filter(isInStock);
  }

  unavailable(): Product[] {
    return this.store.allProducts().filter((p) => !isInStock(p));
  }

  restock(id: string, quantity: number): boolean {
    const product = this.find(id);
    if (!product) {
      this.lastError = `unknown product ${id}`;
      return false;
    }
    this.inventory.add(product, quantity);
    this.cache.clear();
    return true;
  }

  reserve(id: string, quantity: number): boolean {
    const product = this.find(id);
    if (!product) {
      this.lastError = `unknown product ${id}`;
      return false;
    }
    if (!this.inventory.canFulfil(product, quantity)) {
      this.lastError = 'not enough stock';
      return false;
    }
    this.inventory.take(product, quantity);
    this.cache.clear();
    return true;
  }

  priceLabel(id: string): string {
    const product = this.find(id);
    if (!product) return formatMoney(0);
    return formatMoney(this.pricing.effectivePrice(product));
  }

  discountLabel(id: string): string {
    const product = this.find(id);
    if (!product) return '';
    const off = this.pricing.discountCents(product);
    if (off <= 0) return '';
    return `save ${formatMoney(off)}`;
  }

  bulkPrice(ids: readonly string[]): number {
    let total = 0;
    for (const id of ids) {
      const product = this.find(id);
      if (product) total += this.pricing.effectivePrice(product);
    }
    return total;
  }

  summary(): CatalogSummary {
    const items = this.store.allProducts();
    if (items.length === 0) {
      return { count: 0, stock: 0, cheapest: '', dearest: '' };
    }
    let cheapest = items[0];
    let dearest = items[0];
    for (const product of items) {
      if (product.priceCents < cheapest.priceCents) cheapest = product;
      if (product.priceCents > dearest.priceCents) dearest = product;
    }
    return {
      count: items.length,
      stock: totalStock(items),
      cheapest: cheapest.name,
      dearest: dearest.name,
    };
  }

  lowStock(threshold: number): Product[] {
    return this.store.allProducts().filter((p) => p.stock > 0 && p.stock < threshold);
  }

  tagged(tag: string): Product[] {
    return this.store.allProducts().filter((p) => p.tags.includes(tag));
  }

  allTags(): string[] {
    const tags = new Set<string>();
    for (const product of this.store.allProducts()) {
      for (const tag of product.tags) tags.add(tag);
    }
    return [...tags].sort();
  }

  rename(id: string, name: string): boolean {
    const product = this.find(id);
    if (!product) return false;
    product.name = name;
    this.cache.clear();
    return true;
  }

  recategorise(id: string, category: string): boolean {
    const product = this.find(id);
    if (!product) return false;
    product.category = category;
    this.cache.clear();
    return true;
  }

  error(): string | null {
    return this.lastError;
  }

  clear(): void {
    this.store.reset();
    this.cache.clear();
    this.lastError = null;
  }

  private find(id: string): Product | undefined {
    return this.store.allProducts().find((p) => p.id === id);
  }
}
