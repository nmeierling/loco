import { CatalogStore } from '../core/state/catalog.store';
import { CatalogService } from '../core/services/catalog.service';
import { Product, SortKey } from '../core/models/product';
import { truncate } from '../utils/format';

export class ProductListComponent {
  sortKey: SortKey = 'name';

  constructor(
    private readonly store: CatalogStore,
    private readonly catalog: CatalogService,
  ) {}

  rows(): Product[] {
    return this.catalog.sorted(this.sortKey);
  }

  sortBy(key: SortKey): void {
    this.sortKey = key;
  }

  filter(query: string): void {
    this.store.setQuery(query);
  }

  pick(product: Product): void {
    this.store.selectProduct(product.id);
  }

  clearSelection(): void {
    this.store.selectProduct(null);
  }

  title(product: Product): string {
    return truncate(product.name, 32);
  }
}
