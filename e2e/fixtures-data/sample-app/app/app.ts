import { ApiClient } from './api/client';
import { CatalogService } from './core/services/catalog.service';
import { InventoryService } from './core/services/inventory.service';
import { PricingService } from './core/services/pricing.service';
import { CatalogStore } from './core/state/catalog.store';
import { CartComponent } from './ui/cart.component';
import { CheckoutComponent } from './ui/checkout.component';
import { ProductListComponent } from './ui/product-list.component';
import { defaultConfig } from './config';

export async function bootstrap(): Promise<void> {
  const config = defaultConfig();
  const store = new CatalogStore();
  const pricing = new PricingService();
  const inventory = new InventoryService();
  const catalog = new CatalogService(store, pricing, inventory);
  const client = new ApiClient(config.apiBaseUrl);

  const list = new ProductListComponent(store, catalog);
  const cart = new CartComponent(store, pricing);
  const checkout = new CheckoutComponent(store, catalog);

  catalog.load(await client.listProducts());
  list.sortBy('name');
  cart.label();

  // Two hops down to CatalogStore.selectProduct, so the impact trace has a chain
  // deeper than one level to walk.
  const first = catalog.sorted('name')[0];
  if (first) list.pick(first);
  if (config.checkoutEnabled) {
    checkout.total();
    checkout.confirm();
  }
}
