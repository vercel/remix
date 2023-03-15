const { getAdapterConfig } = require("../../rollup.utils");

/** @returns {import("rollup").RollupOptions[]} */
module.exports = function rollup() {
  return [
    getAdapterConfig("vercel-remix"),
    getAdapterConfig("vercel-remix", "server.ts"),
    getAdapterConfig("vercel-remix", "entry.server.ts"),
    getAdapterConfig("vercel-remix", "edge/index.ts"),
    getAdapterConfig("vercel-remix", "edge/server.ts"),
    getAdapterConfig("vercel-remix", "edge/entry.server.ts"),
  ];
};
