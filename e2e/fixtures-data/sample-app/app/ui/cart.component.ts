import { Subject } from 'rxjs';
import { CatalogStore } from '../core/state/catalog.store';
import { PricingService } from '../core/services/pricing.service';
import { Product } from '../core/models/product';
import { formatCount, formatMoney } from '../utils/format';

export class CartComponent {
  // A third-party dependency, so the usages panel's External tab has something to show.
  readonly changed = new Subject<void>();

  constructor(
    private readonly store: CatalogStore,
    private readonly pricing: PricingService,
  ) {}

  lines(): { product: Product; quantity: number; total: string }[] {
    const products = this.store.allProducts();
    const out: { product: Product; quantity: number; total: string }[] = [];
    for (const line of this.store.cartLines()) {
      const product = products.find((p) => p.id === line.productId);
      if (!product) continue;
      out.push({
        product,
        quantity: line.quantity,
        total: formatMoney(this.pricing.lineTotal(product, line.quantity)),
      });
    }
    return out;
  }

  open(productId: string): void {
    this.store.selectProduct(productId);
  }

  close(): void {
    this.store.selectProduct(null);
  }

  remove(productId: string): void {
    this.store.removeLine(productId);
  }

  label(): string {
    return formatCount(this.store.cartLines().length, 'line');
  }
}
