import { CatalogStore } from '../core/state/catalog.store';
import { CatalogService } from '../core/services/catalog.service';
import { formatMoney } from '../utils/format';

export class CheckoutComponent {
  constructor(
    private readonly store: CatalogStore,
    private readonly catalog: CatalogService,
  ) {}

  total(): string {
    const ids = this.store.cartLines().map((l) => l.productId);
    return formatMoney(this.catalog.bulkPrice(ids));
  }

  confirm(): boolean {
    for (const line of this.store.cartLines()) {
      if (!this.catalog.reserve(line.productId, line.quantity)) return false;
    }
    this.store.selectProduct(null);
    return true;
  }

  cancel(): void {
    this.store.reset();
  }
}
