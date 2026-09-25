/**
 * @jest-environment jsdom
 *
 * Skeleton placeholder shape/size across every template that ships it
 * (#1039).
 *
 * Skeleton's public API is Tailwind class props: `width` and `height` size
 * the block, `className` adds shape (e.g. `rounded-full` for an avatar).
 * These assertions pin that contract so a template whose copy drops or
 * hardcodes a size/shape class fails here.
 */
import "@testing-library/jest-dom";
import React from "react";
import { render } from "@testing-library/react";

type SkeletonComponent = React.ComponentType<{
  width?: string;
  height?: string;
  className?: string;
}>;

/** Every template that ships a Skeleton, with its source extension. */
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
    return { ...template, Skeleton: mod.Skeleton as SkeletonComponent };
  }),
);

describe.each(loaded)("$name template Skeleton (.$ext)", ({ Skeleton }) => {
  function renderPlaceholder(
    props: React.ComponentProps<SkeletonComponent> = {},
  ) {
    const { container } = render(<Skeleton {...props} />);
    return container.firstElementChild as HTMLElement;
  }

  it("renders a single empty placeholder hidden from assistive tech", () => {
    const { container } = render(<Skeleton />);

    expect(container.childElementCount).toBe(1);
    const placeholder = container.firstElementChild;
    expect(placeholder).toBeEmptyDOMElement();
    expect(placeholder).toHaveAttribute("aria-hidden", "true");
    expect(placeholder).toHaveClass("animate-pulse");
  });

  it("defaults to a full-width, single-line-height rounded block", () => {
    expect(renderPlaceholder()).toHaveClass("w-full", "h-4", "rounded");
  });

  it("sizes the block from the width and height props", () => {
    const placeholder = renderPlaceholder({ width: "w-28", height: "h-8" });

    expect(placeholder).toHaveClass("w-28", "h-8");
    expect(placeholder).not.toHaveClass("w-full");
    expect(placeholder).not.toHaveClass("h-4");
  });

  it("keeps the default height when only a width is given", () => {
    const placeholder = renderPlaceholder({ width: "w-20" });

    expect(placeholder).toHaveClass("w-20", "h-4");
    expect(placeholder).not.toHaveClass("w-full");
  });

  it("renders a circular avatar shape via className", () => {
    const placeholder = renderPlaceholder({
      width: "w-10",
      height: "h-10",
      className: "rounded-full",
    });

    expect(placeholder).toHaveClass("w-10", "h-10", "rounded-full");
  });
});
