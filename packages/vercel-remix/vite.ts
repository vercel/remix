import { writeFileSync } from "fs";
import { Project } from "ts-morph";
import { getConfig, type BaseFunctionConfig } from "@vercel/static-config";
import type { Preset } from "@remix-run/dev/vite/plugin";
import type { ConfigRoute } from "@remix-run/dev/config/routes";

function hash(config: Record<string, unknown>): string {
  let str = JSON.stringify(config);
  return Buffer.from(str).toString("base64url");
}

function writeJson(path: string, data: Record<string, unknown>) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function flattenAndSort(o: Record<string, unknown>) {
  let n: Record<string, unknown> = {};
  let keys: string[] = [];
  for (let key in o) keys.push(key);
  for (let key of keys.sort()) n[key] = o[key];
  return n;
}

export function vercel(): Preset {
  let project = new Project();
  let configCache = new Map<string, BaseFunctionConfig>();

  function getRouteConfig(branch: ConfigRoute[], index = branch.length - 1) {
    let route = branch[index];
    let config = configCache.get(route.id);
    if (!config) {
      // @ts-expect-error Meh...
      config = getConfig(project, route.file) || {};
      if (index > 0) {
        Object.setPrototypeOf(config, getRouteConfig(branch, index - 1));
      }
      configCache.set(route.id, config);
    }
    return config;
  }

  return {
    name: "vercel",
    remixConfig() {
      return {
        serverBundles({ branch }) {
          let route = branch[branch.length - 1];
          let config = getRouteConfig(branch);
          if (!config.runtime) {
            config.runtime = "nodejs";
          }
          config = flattenAndSort(config);
          configCache.set(route.id, config);
          return `${config.runtime}-${hash(config)}`;
        },
        buildEnd({ buildManifest, remixConfig }) {
          if (buildManifest) {
            for (let route of Object.values(buildManifest.routes)) {
              (route as typeof route & { config?: BaseFunctionConfig }).config =
                configCache.get(route.id);
            }
          }
          writeJson(".vercel-remix-result.json", {
            buildManifest,
            remixConfig,
          });
        },
      };
    },
  };
}
