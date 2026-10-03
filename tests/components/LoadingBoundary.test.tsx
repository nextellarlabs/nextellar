/**
 * @jest-environment jsdom
 *
 * LoadingBoundary loading and resolved states (#1038).
 *
 * Children suspend on a deferred resource the test resolves explicitly, so
 * the loading -> resolved transition is driven by the test rather than by
 * timers.
 */
import "@testing-library/jest-dom";
import React from "react";
import { act, render, screen } from "@testing-library/react";
import LoadingBoundary from "../../src/templates/default/src/components/LoadingBoundary";

function createDeferredResource<T>(value: T) {
  let settled = false;
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  }).then(() => {
    settled = true;
  });

  return {
    read(): T {
      if (!settled) throw promise;
      return value;
    },
    async resolve() {
      await act(async () => {
        resolve();
        await promise;
      });
    },
  };
}

function Balance({ resource }: { resource: { read(): string } }) {
  return <p>{resource.read()}</p>;
}

function rowCount(region: HTMLElement) {
  return (region.firstElementChild as HTMLElement).children.length;
}

describe("LoadingBoundary", () => {
  describe("loading state", () => {
    it("shows the labelled skeleton fallback while children suspend", async () => {
      const resource = createDeferredResource("100 XLM");

      await act(async () => {
        render(
          <LoadingBoundary label="Loading balances">
            <Balance resource={resource} />
          </LoadingBoundary>,
        );
      });

      expect(
        screen.getByRole("status", { name: "Loading balances" }),
      ).toBeInTheDocument();
      expect(screen.queryByText("100 XLM")).not.toBeInTheDocument();
    });

    it("defaults the fallback to 4 rows labelled 'Loading'", async () => {
      const resource = createDeferredResource("100 XLM");

      await act(async () => {
        render(
          <LoadingBoundary>
            <Balance resource={resource} />
          </LoadingBoundary>,
        );
      });

      expect(rowCount(screen.getByRole("status", { name: "Loading" }))).toBe(4);
    });

    it("sizes the default fallback to the rows prop", async () => {
      const resource = createDeferredResource("100 XLM");

      await act(async () => {
        render(
          <LoadingBoundary rows={2}>
            <Balance resource={resource} />
          </LoadingBoundary>,
        );
      });

      expect(rowCount(screen.getByRole("status"))).toBe(2);
    });

    it("shows a custom fallback instead of the skeleton", async () => {
      const resource = createDeferredResource("100 XLM");

      await act(async () => {
        render(
          <LoadingBoundary fallback={<p>Fetching from Horizon…</p>}>
            <Balance resource={resource} />
          </LoadingBoundary>,
        );
      });

      expect(screen.getByText("Fetching from Horizon…")).toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });

  describe("resolved state", () => {
    it("replaces the fallback with the content once it resolves", async () => {
      const resource = createDeferredResource("100 XLM");

      await act(async () => {
        render(
          <LoadingBoundary label="Loading balances">
            <Balance resource={resource} />
          </LoadingBoundary>,
        );
      });
      expect(
        screen.getByRole("status", { name: "Loading balances" }),
      ).toBeInTheDocument();

      await resource.resolve();

      expect(await screen.findByText("100 XLM")).toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("replaces a custom fallback with the content once it resolves", async () => {
      const resource = createDeferredResource("100 XLM");

      await act(async () => {
        render(
          <LoadingBoundary fallback={<p>Fetching from Horizon…</p>}>
            <Balance resource={resource} />
          </LoadingBoundary>,
        );
      });

      await resource.resolve();

      expect(await screen.findByText("100 XLM")).toBeInTheDocument();
      expect(
        screen.queryByText("Fetching from Horizon…"),
      ).not.toBeInTheDocument();
    });

    it("renders children directly when nothing suspends", () => {
      render(
        <LoadingBoundary>
          <p>Content has loaded.</p>
        </LoadingBoundary>,
      );

      expect(screen.getByText("Content has loaded.")).toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });
});
