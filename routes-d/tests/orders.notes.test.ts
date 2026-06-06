import express, { type Express } from "express";
import request from "supertest";
import {
  InMemoryOrderNotesStore,
  __resetOrderNoteIds,
  type OrderNote,
} from "../lib/orderNotes.js";
import { createOrdersNotesRouter, type NoteAuthor } from "../routes/orders.notes.js";

function buildApp(author: NoteAuthor | null, store = new InMemoryOrderNotesStore()): Express {
  const app = express();
  app.use(express.json());
  app.use(
    "/orders",
    createOrdersNotesRouter({
      store,
      getAuthor: () => author,
    }),
  );
  return app;
}

describe("orders notes routes", () => {
  beforeEach(() => {
    __resetOrderNoteIds();
  });

  it("creates an internal note with author audit fields", async () => {
    const app = buildApp({ authorId: "admin-1", authorRole: "admin", canViewInternal: true });

    const res = await request(app).post("/orders/o-1/notes").send({
      type: "internal",
      body: "Refund approved offline",
    });

    expect(res.status).toBe(201);
    expect(res.body.note).toMatchObject({
      orderId: "o-1",
      type: "internal",
      body: "Refund approved offline",
      authorId: "admin-1",
      authorRole: "admin",
    });
    expect(res.body.note.createdAt).toEqual(expect.any(Number));
  });

  it("lists all notes for admins", async () => {
    const store = new InMemoryOrderNotesStore();
    await store.create({
      orderId: "o-1",
      type: "internal",
      body: "ops only",
      authorId: "admin-1",
      authorRole: "admin",
    });
    await store.create({
      orderId: "o-1",
      type: "customer",
      body: "Your package ships tomorrow",
      authorId: "admin-1",
      authorRole: "admin",
    });

    const app = buildApp({ authorId: "admin-1", authorRole: "admin", canViewInternal: true }, store);
    const res = await request(app).get("/orders/o-1/notes");

    expect(res.status).toBe(200);
    expect(res.body.notes).toHaveLength(2);
  });

  it("filters customer-visible notes for non-admin callers", async () => {
    const store = new InMemoryOrderNotesStore();
    await store.create({
      orderId: "o-1",
      type: "internal",
      body: "ops only",
      authorId: "admin-1",
      authorRole: "admin",
    });
    await store.create({
      orderId: "o-1",
      type: "customer",
      body: "Your package ships tomorrow",
      authorId: "admin-1",
      authorRole: "admin",
    });

    const app = buildApp({ authorId: "user-1", authorRole: "user", canViewInternal: false }, store);
    const res = await request(app).get("/orders/o-1/notes");

    expect(res.status).toBe(200);
    const notes = res.body.notes as OrderNote[];
    expect(notes).toHaveLength(1);
    expect(notes[0]?.type).toBe("customer");
  });

  it("returns 403 when a non-admin tries to create a note", async () => {
    const app = buildApp({ authorId: "user-1", authorRole: "user", canViewInternal: false });

    const res = await request(app).post("/orders/o-1/notes").send({
      type: "customer",
      body: "hello",
    });

    expect(res.status).toBe(403);
  });
});
