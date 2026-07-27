import { Product } from '../models/product';

const BULK_THRESHOLD = 10;
const BULK_RATE = 0.9;

export class PricingService {
  private rules = new Map<string, number>([
    ['clearance', 0.5],
    ['sale', 0.8],
  ]);

  effectivePrice(product: Product): number {
    let price = product.priceCents;
    for (const tag of product.tags) {
      const rate = this.rules.get(tag);
      if (rate !== undefined) price = Math.round(price * rate);
    }
    return price;
  }

  discountCents(product: Product): number {
    return product.priceCents - this.effectivePrice(product);
  }

  lineTotal(product: Product, quantity: number): number {
    const unit = this.effectivePrice(product);
    if (quantity >= BULK_THRESHOLD) return Math.round(unit * quantity * BULK_RATE);
    return unit * quantity;
  }

  addRule(tag: string, rate: number): void {
    this.rules.set(tag, rate);
  }
}
