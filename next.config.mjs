/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // Resolve NodeNext-style ".js" import specifiers to the ".ts" source files. Next 16 defaults
    // to Turbopack, which has no extensionAlias, so the package.json scripts pass --webpack.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default nextConfig;
