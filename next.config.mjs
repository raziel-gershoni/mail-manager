/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // Resolve NodeNext-style ".js" import specifiers to the ".ts" source files.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default nextConfig;
