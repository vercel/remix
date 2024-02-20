import { Project } from "ts-morph";
import { join, basename, extname } from "path";
import { mkdirSync, writeFileSync, cpSync, rmSync, readdirSync } from "fs";
import { getConfig, type BaseFunctionConfig } from "@vercel/static-config";
import type { Preset } from "@remix-run/dev/vite/plugin";
import type { ConfigRoute } from "@remix-run/dev/config/routes";

function hash(config: Record<string, unknown>): string {
  let str = JSON.stringify(config);
  return Buffer.from(str).toString("base64url");
}

function flattenAndSort(o: Record<string, unknown>) {
  let n: Record<string, unknown> = {};
  let keys: string[] = [];
  for (let key in o) keys.push(key);
  for (let key of keys.sort()) n[key] = o[key];
  return n;
}

export function vercelPreset(): Preset {
  let project = new Project();
  let entryServerPath: string | undefined;
  let addedEntryServer = false;
  let routeConfigs = new Map<string, BaseFunctionConfig>();
  let bundleConfigs = new Map<string, BaseFunctionConfig>();

  function getRouteConfig(branch: ConfigRoute[], index = branch.length - 1) {
    let route = branch[index];
    let config = routeConfigs.get(route.id);
    if (!config) {
      // @ts-expect-error Meh...
      config = getConfig(project, route.file) || {};
      if (index > 0) {
        Object.setPrototypeOf(config, getRouteConfig(branch, index - 1));
      }
      routeConfigs.set(route.id, config);
    }
    return config;
  }

  return {
    name: "vercel",
    remixConfig({ remixUserConfig }) {
      console.log(remixUserConfig);
      return {
        serverBundles: remixUserConfig.ssr
          ? ({ branch }) => {
              let config = getRouteConfig(branch);
              if (!config.runtime) {
                config.runtime = "nodejs";
              }

              if (config.runtime === "edge" && !entryServerPath) {
                let appDirectory = remixUserConfig.appDirectory ?? "app";
                let entryServerFile = readdirSync(appDirectory).find((f) =>
                  basename(f, extname(f)) === 'entry.server'
                );
                if (entryServerFile) {
                  entryServerPath = join(appDirectory, entryServerFile);
                } else {
                  entryServerPath = join(appDirectory, "entry.server.jsx");
                  addedEntryServer = true;
                  cpSync(
                    join(__dirname, "defaults/entry.server.jsx"),
                    entryServerPath
                  );
                }
                console.log({ entryServerPath });
              }

              config = flattenAndSort(config);
              let id = `${config.runtime}-${hash(config)}`;
              if (!bundleConfigs.has(id)) {
                bundleConfigs.set(id, config);
              }
              return id;
            }
          : undefined,
        buildEnd({ buildManifest, remixConfig }) {
          if (addedEntryServer && entryServerPath) {
            // Clean up after ourselves
            rmSync(entryServerPath);
          }

          if (buildManifest?.serverBundles && bundleConfigs.size) {
            for (let bundle of Object.values(buildManifest.serverBundles)) {
              let bundleWtihConfig = {
                ...bundle,
                config: bundleConfigs.get(bundle.id),
              };
              buildManifest.serverBundles[bundle.id] = bundleWtihConfig;
            }
          }
          if (buildManifest?.routes && routeConfigs.size) {
            for (let route of Object.values(buildManifest.routes)) {
              let routeWtihConfig = {
                ...route,
                config: routeConfigs.get(route.id),
              };
              buildManifest.routes[route.id] = routeWtihConfig;
            }
          }
          let json = JSON.stringify(
            {
              buildManifest,
              remixConfig,
            },
            null,
            2
          );
          mkdirSync(".vercel", { recursive: true });
          writeFileSync(".vercel/remix-build-result.json", `${json}\n`);
        },
      };
    },
  };
}
