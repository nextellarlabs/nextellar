/**
 * Fixed-capacity FIFO buffer; oldest entries are dropped when capacity is exceeded.
 */
export class BoundedEventBuffer<T> {
  private readonly items: T[] = [];

  constructor(private readonly maxSize: number) {
    if (!Number.isInteger(maxSize) || maxSize < 1) {
      throw new Error('maxSize must be a positive integer');
    }
  }

  get size(): number {
    return this.items.length;
  }

  get capacity(): number {
    return this.maxSize;
  }

  push(item: T): void {
    this.items.push(item);
    while (this.items.length > this.maxSize) {
      this.items.shift();
    }
  }

  toArray(): T[] {
    return [...this.items];
  }

  clear(): void {
    this.items.length = 0;
  }
}
