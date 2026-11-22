import type { ImgHTMLAttributes } from "react";

type NextImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  unoptimized?: boolean;
  priority?: boolean;
};

/**
 * Test stand-in for `next/image`, which isn't a dependency of the CLI repo
 * itself. Renders a plain <img> and drops Next-only props.
 */
export default function Image(props: NextImageProps) {
  const imgProps = { ...props };
  delete imgProps.unoptimized;
  delete imgProps.priority;
  return <img {...imgProps} />;
}
