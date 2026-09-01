export interface CartLine {
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  modifierIds: string[];
  modifierLabel: string;
}

const STORAGE_KEY = "fasdely-cart-v1";

function lineKey(productId: string, modifierIds: string[]): string {
  return `${productId}::${[...modifierIds].sort().join(",")}`;
}

export class CartStore {
  private lines: Map<string, CartLine> = new Map();

  add(line: CartLine): void {
    const key = lineKey(line.productId, line.modifierIds);
    const existing = this.lines.get(key);
    if (existing) {
      existing.quantity += line.quantity;
    } else {
      this.lines.set(key, { ...line });
    }
  }

  remove(productId: string, modifierIds: string[]): void {
    this.lines.delete(lineKey(productId, modifierIds));
  }

  setQuantity(productId: string, modifierIds: string[], quantity: number): void {
    const key = lineKey(productId, modifierIds);
    if (quantity <= 0) {
      this.lines.delete(key);
      return;
    }
    const existing = this.lines.get(key);
    if (existing) existing.quantity = quantity;
  }

  clear(): void {
    this.lines.clear();
  }

  getLines(): CartLine[] {
    return [...this.lines.values()];
  }

  getTotal(): number {
    return this.getLines().reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  }

  save(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.getLines()));
  }

  static load(): CartStore {
    const store = new CartStore();
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return store;
    try {
      const lines: CartLine[] = JSON.parse(raw);
      for (const line of lines) store.lines.set(lineKey(line.productId, line.modifierIds), line);
    } catch {
      // corrupted storage — start with an empty cart rather than throwing
    }
    return store;
  }
}
