const nextConfig = {
  images: {
    // Serve modern, smaller formats to browsers that support them —
    // next/image negotiates via Accept headers and falls back to the
    // original format automatically, so this is a safe default.
    formats: ["image/avif", "image/webp"],
  },
};
export default nextConfig;
