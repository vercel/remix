const { getAdapterConfig } = require("../../rollup.utils");

/** @returns {import("rollup").RollupOptions[]} */
module.exports = function rollup() {
  return [
    getAdapterConfig("vercel-remix"),
    getAdapterConfig("vercel-remix", "edge/index.ts"),
  ];
};
