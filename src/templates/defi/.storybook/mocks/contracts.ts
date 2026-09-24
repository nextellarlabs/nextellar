export const CONTRACTS = {
  COUNTER: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMDR4",
};

export class CounterClient {
  private count = 0;

  constructor(_contract: unknown) {}

  async initialize(args: { initial_count: number }) {
    this.count = args.initial_count;
  }

  async getCount() {
    return this.count;
  }

  async increment() {
    return ++this.count;
  }

  async decrement() {
    return --this.count;
  }

  async add(args: { amount: number }) {
    this.count += args.amount;
    return this.count;
  }

  async reset() {
    this.count = 0;
  }
}
