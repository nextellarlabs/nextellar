import { Router, type Request, type Response } from "express";
import {
  isOrderNoteType,
  type OrderNotesStore,
  type OrderNoteType,
} from "../lib/orderNotes.js";

export interface NoteAuthor {
  authorId: string;
  authorRole: string;
  canViewInternal: boolean;
}

export interface OrdersNotesRouterOptions {
  store: OrderNotesStore;
  getAuthor?: (req: Request) => NoteAuthor | null;
}

interface CreateNoteBody {
  type?: unknown;
  body?: unknown;
}

interface NotesRequest extends Request {
  user?: { role?: unknown };
}

function defaultGetAuthor(req: Request): NoteAuthor | null {
  const authReq = req as NotesRequest;
  const sub = authReq.jwt?.sub;
  if (!sub) return null;
  const role = typeof authReq.user?.role === "string" ? authReq.user.role : "user";
  return {
    authorId: sub,
    authorRole: role,
    canViewInternal: role === "admin" || role === "moderator",
  };
}

export function createOrdersNotesRouter(opts: OrdersNotesRouterOptions): Router {
  const router = Router({ mergeParams: true });
  const getAuthor = opts.getAuthor ?? defaultGetAuthor;

  router.post("/:orderId/notes", async (req: Request, res: Response) => {
    const author = getAuthor(req);
    if (!author) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    if (!author.canViewInternal) {
      res.status(403).json({ ok: false, error: "insufficient role" });
      return;
    }

    const { orderId } = req.params as { orderId: string };
    const body = (req.body ?? {}) as CreateNoteBody;

    if (!isOrderNoteType(body.type)) {
      res.status(400).json({ ok: false, error: "type must be internal or customer" });
      return;
    }

    if (typeof body.body !== "string" || body.body.trim().length === 0) {
      res.status(400).json({ ok: false, error: "body is required" });
      return;
    }

    const note = await opts.store.create({
      orderId,
      type: body.type as OrderNoteType,
      body: body.body,
      authorId: author.authorId,
      authorRole: author.authorRole,
    });

    res.status(201).json({ ok: true, note });
  });

  router.get("/:orderId/notes", async (req: Request, res: Response) => {
    const author = getAuthor(req);
    if (!author) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    const { orderId } = req.params as { orderId: string };
    const notes = await opts.store.listByOrder(orderId, {
      visibleToCustomer: !author.canViewInternal,
    });

    res.status(200).json({ ok: true, notes });
  });

  return router;
}
