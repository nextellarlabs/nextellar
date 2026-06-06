export type OrderNoteType = "internal" | "customer";

export interface OrderNote {
  id: string;
  orderId: string;
  type: OrderNoteType;
  body: string;
  authorId: string;
  authorRole: string;
  createdAt: number;
}

export interface CreateOrderNoteInput {
  orderId: string;
  type: OrderNoteType;
  body: string;
  authorId: string;
  authorRole: string;
  createdAt?: number;
}

export interface OrderNotesStore {
  create(input: CreateOrderNoteInput): Promise<OrderNote>;
  listByOrder(orderId: string, opts?: { visibleToCustomer?: boolean }): Promise<OrderNote[]>;
}

let noteSeq = 0;

export function __resetOrderNoteIds(): void {
  noteSeq = 0;
}

export class InMemoryOrderNotesStore implements OrderNotesStore {
  private readonly notes: OrderNote[] = [];

  async create(input: CreateOrderNoteInput): Promise<OrderNote> {
    const note: OrderNote = {
      id: `note_${++noteSeq}`,
      orderId: input.orderId,
      type: input.type,
      body: input.body.trim(),
      authorId: input.authorId,
      authorRole: input.authorRole,
      createdAt: input.createdAt ?? Date.now(),
    };
    this.notes.push(note);
    return note;
  }

  async listByOrder(orderId: string, opts: { visibleToCustomer?: boolean } = {}): Promise<OrderNote[]> {
    const filtered = this.notes.filter((n) => n.orderId === orderId);
    if (opts.visibleToCustomer) {
      return filtered
        .filter((n) => n.type === "customer")
        .sort((a, b) => a.createdAt - b.createdAt);
    }
    return filtered.slice().sort((a, b) => a.createdAt - b.createdAt);
  }
}

export function isOrderNoteType(value: unknown): value is OrderNoteType {
  return value === "internal" || value === "customer";
}
