/**
 * @jest-environment jsdom
 *
 * Skeleton/SkeletonList loading announcements (#1142).
 *
 * A loading skeleton must tell screen-reader users that content is on its
 * way: SkeletonList exposes a polite, busy status region with a label, and a
 * standalone Skeleton does the same when given a `label`. Without a label a
 * Skeleton stays decorative so it can sit inside a larger region without
 * being announced once per block.
 */
import "@testing-library/jest-dom";
import React from "react";
import { render, screen, within } from "@testing-library/react";

type SkeletonComponent = React.ComponentType<{
  width?: string;
  height?: string;
  className?: string;
  label?: string;
}>;
type SkeletonListComponent = React.ComponentType<{
  rows?: number;
  label?: string;
  renderRow?: (index: number) => React.ReactNode;
}>;

/** Every template that ships Skeleton/SkeletonList, and where each lives. */
const TEMPLATES: Array<{ name: string; skeleton: string; list: string }> = [
  { name: "default", skeleton: "Skeleton", list: "Skeleton" },
  { name: "defi", skeleton: "Skeleton", list: "Skeleton" },
  { name: "minimal", skeleton: "Skeleton", list: "Skeleton" },
  { name: "js-defi", skeleton: "Skeleton", list: "Skeleton" },
  { name: "js-template", skeleton: "Skeleton", list: "SkeletonList" },
];

const loaded = await Promise.all(
  TEMPLATES.map(async (template) => {
    const base = `../../src/templates/${template.name}/src/components`;
    const skeletonMod = await import(`${base}/${template.skeleton}`);
    const listMod = await import(`${base}/${template.list}`);
    return {
      name: template.name,
      Skeleton: skeletonMod.Skeleton as SkeletonComponent,
      SkeletonList: listMod.SkeletonList as SkeletonListComponent,
    };
  }),
);

describe.each(loaded)("$name template loading announcements", ({ Skeleton, SkeletonList }) => {
  describe("SkeletonList", () => {
    it("renders a busy, polite status region named by its label", () => {
      render(<SkeletonList rows={3} label="Loading transaction history" />);

      const region = screen.getByRole("status", { name: "Loading transaction history" });
      expect(region).toHaveAttribute("aria-busy", "true");
      expect(region).toHaveAttribute("aria-live", "polite");
    });

    it("includes a screen-reader-only loading announcement", () => {
      render(<SkeletonList label="Loading balances" />);

      const region = screen.getByRole("status", { name: "Loading balances" });
      const announcement = within(region).getByText("Loading balances...");
      expect(announcement).toHaveClass("sr-only");
    });

    it("falls back to a generic 'Loading' announcement", () => {
      render(<SkeletonList />);

      const region = screen.getByRole("status", { name: "Loading" });
      expect(region).toHaveAttribute("aria-busy", "true");
      expect(within(region).getByText("Loading...")).toBeInTheDocument();
    });

    it("hides the placeholder rows from assistive tech", () => {
      render(
        <SkeletonList rows={2} renderRow={(i) => <span data-testid="row">{i}</span>} />,
      );

      for (const row of screen.getAllByTestId("row")) {
        expect(row.closest("[aria-hidden='true']")).not.toBeNull();
      }
    });

    it("exposes exactly one status region however many rows it renders", () => {
      render(<SkeletonList rows={6} label="Loading" />);

      expect(screen.getAllByRole("status")).toHaveLength(1);
    });
  });

  describe("Skeleton", () => {
    it("stays decorative and silent without a label", () => {
      const { container } = render(<Skeleton />);

      expect(screen.queryByRole("status")).toBeNull();
      expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
      expect(container.firstElementChild).not.toHaveAttribute("aria-busy");
    });

    it("announces loading when given a label", () => {
      render(<Skeleton width="w-28" label="Loading balance" />);

      const status = screen.getByRole("status", { name: "Loading balance" });
      expect(status).toHaveAttribute("aria-busy", "true");
      expect(status).toHaveAttribute("aria-live", "polite");
      expect(status).not.toHaveAttribute("aria-hidden");
      expect(within(status).getByText("Loading balance...")).toHaveClass("sr-only");
    });

    it("keeps its size and shape classes when labelled", () => {
      render(<Skeleton width="w-10" height="h-10" className="rounded-full" label="Loading avatar" />);

      expect(screen.getByRole("status", { name: "Loading avatar" })).toHaveClass(
        "animate-pulse",
        "w-10",
        "h-10",
        "rounded-full",
      );
    });

    it("treats an empty label as decorative", () => {
      render(<Skeleton label="" />);

      expect(screen.queryByRole("status")).toBeNull();
    });
  });
});
