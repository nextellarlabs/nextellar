/**
 * @jest-environment jsdom
 *
 * SkeletonList row count across every template that ships it (#1040).
 *
 * BalanceDisplay and TransactionList size their loading state with `rows`
 * so the skeleton matches the list it stands in for; a wrong count means
 * layout shift once data arrives.
 */
import "@testing-library/jest-dom";
import React from "react";
import { render, screen } from "@testing-library/react";

type SkeletonListComponent = React.ComponentType<{
  rows?: number;
  label?: string;
  renderRow?: (index: number) => React.ReactNode;
}>;

/** Every template that ships a SkeletonList, with its source extension. */
const TEMPLATES: Array<{ name: string; ext: "tsx" | "jsx" }> = [
  { name: "default", ext: "tsx" },
  { name: "defi", ext: "tsx" },
  { name: "minimal", ext: "tsx" },
  { name: "js-defi", ext: "jsx" },
];

const loaded = await Promise.all(
  TEMPLATES.map(async (template) => {
    const mod = await import(
      `../../src/templates/${template.name}/src/components/Skeleton`
    );
    return {
      ...template,
      SkeletonList: mod.SkeletonList as SkeletonListComponent,
    };
  }),
);

const renderRow = (index: number) => (
  <span data-testid="skeleton-row">{index}</span>
);

describe.each(loaded)(
  "$name template SkeletonList (.$ext)",
  ({ SkeletonList }) => {
    it.each([1, 3, 7])("renders exactly %i rows when given rows", (rows) => {
      render(<SkeletonList rows={rows} renderRow={renderRow} />);

      expect(screen.getAllByTestId("skeleton-row")).toHaveLength(rows);
    });

    it("defaults to 4 rows", () => {
      render(<SkeletonList renderRow={renderRow} />);

      expect(screen.getAllByTestId("skeleton-row")).toHaveLength(4);
    });

    it("passes each row its zero-based index", () => {
      render(<SkeletonList rows={3} renderRow={renderRow} />);

      expect(
        screen.getAllByTestId("skeleton-row").map((row) => row.textContent),
      ).toEqual(["0", "1", "2"]);
    });

    it("renders the default row shape once per row", () => {
      render(<SkeletonList rows={3} label="Loading transaction history" />);

      const region = screen.getByRole("status", {
        name: "Loading transaction history",
      });
      const list = region.firstElementChild as HTMLElement;
      expect(list.children).toHaveLength(3);
      for (const row of Array.from(list.children)) {
        expect(row.querySelector("[aria-hidden='true']")).not.toBeNull();
      }
    });

    it("announces the loading label once regardless of row count", () => {
      render(<SkeletonList rows={5} label="Loading balances" />);

      expect(
        screen.getByRole("status", { name: "Loading balances" }),
      ).toBeInTheDocument();
      expect(screen.getAllByText("Loading balances...")).toHaveLength(1);
    });
  },
);
