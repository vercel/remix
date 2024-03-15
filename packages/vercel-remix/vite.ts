import { createHash } from "crypto";
import { Project } from "ts-morph";
import { join, basename, extname } from "path";
import {
  mkdirSync,
  writeFileSync,
  cpSync,
  rmSync,
  readdirSync,
  readFileSync,
} from "fs";
import { getConfig, type BaseFunctionConfig } from "@vercel/static-config";
import type { Preset, VitePluginConfig } from "@remix-run/dev/vite/plugin";
import type { ConfigRoute } from "@remix-run/dev/config/routes";

interface EntryServerShas {
  [sha: string]: {
    commits: string[];
    templates: string[];
  };
}

function hashConfig(config: Record<string, unknown>): string {
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

function runOnce<T extends (...args: any[]) => any>(fn: T) {
  let ran = false;
  return (...args: Parameters<T>) => {
    if (ran) return;
    ran = true;
    fn(...args);
  };
}

function getEntryServerShas(): EntryServerShas {
  return JSON.parse(
    readFileSync(join(__dirname, "entry-server-shas.json"), "utf8")
  );
}

export function vercelPreset(): Preset {
  let project = new Project();
  let vercelEntryServerPath: string | undefined;
  let originalEntryServerPath: string | undefined;
  let originalEntryServerContents: string | undefined;
  let routeConfigs = new Map<string, BaseFunctionConfig>();
  let bundleConfigs = new Map<string, BaseFunctionConfig>();

  function getRouteConfig(branch: ConfigRoute[], index = branch.length - 1) {
    let route = branch[index];
    let config = routeConfigs.get(route.id);
    if (!config) {
      // @ts-expect-error TODO: figure out why TypeScript is complaining here…
      config = getConfig(project, route.file) || {};
      if (index > 0) {
        Object.setPrototypeOf(config, getRouteConfig(branch, index - 1));
      }
      routeConfigs.set(route.id, config);
    }
    return config;
  }

  // If there are any "edge" runtime routes, then the
  // `entry.server` file needs use the `@vercel/remix` package.
  //
  //  - If there is no `entry.server` file, then we copy in the Vercel entry server
  //  - If there is a `entry.server` file, then we hash the contents to
  //    try to determine if the file has been modified from a known default
  //    Remix template.
  //      - If there's a hash match, we can safely copy in the Vercel entry server
  //      - If there's no match, then we run a RegExp on the contents to see if `@vercel/remix` is being used
  //          - If no RegExp match, we print a warning and link to docs, but continue the build
  let injectVercelEntryServer = runOnce((remixUserConfig: VitePluginConfig) => {
    let appDirectory = remixUserConfig.appDirectory ?? "app";
    let entryServerFile = readdirSync(appDirectory).find(
      (f) => basename(f, extname(f)) === "entry.server"
    );
    if (entryServerFile) {
      originalEntryServerPath = join(appDirectory, entryServerFile);
      originalEntryServerContents = readFileSync(
        originalEntryServerPath,
        "utf8"
      );
      let entryServerHash = createHash("sha256")
        .update(originalEntryServerContents)
        .digest("hex");
      if (Object.keys(getEntryServerShas()).includes(entryServerHash)) {
        console.log(`[vc] Detected unmodified "${entryServerFile}". Copying in default "entry.server.jsx".`);
        rmSync(originalEntryServerPath);
        vercelEntryServerPath = join(appDirectory, "entry.server.jsx");
        cpSync(
          join(__dirname, "defaults/entry.server.jsx"),
          vercelEntryServerPath
        );
      } else {
        let usesVercelRemixPackage = /["']@vercel\/remix['"]/.test(
          originalEntryServerContents
        );
        if (usesVercelRemixPackage) {
          console.log(
            `[vc] Detected "${entryServerFile}" using \`@vercel/remix\``
          );
        } else {
          console.warn(
            `WARN: The \`@vercel/remix\` package was not detected in your "${entryServerFile}" file.`
          );
          console.warn(
            `WARN: Using the Edge Runtime may not work with your current configuration.`
          );
          console.warn(
            `WARN: Please see the docs to learn how to use a custom "${entryServerFile}":`
          );
          console.warn(
            `WARN: https://vercel.com/docs/frameworks/remix#using-a-custom-app/entry.server-file`
          );
        }
      }
    } else {
      console.log(`[vc] No "entry.server" found. Copying in default "entry.server.jsx".`);
      vercelEntryServerPath = join(appDirectory, "entry.server.jsx");
      cpSync(
        join(__dirname, "defaults/entry.server.jsx"),
        vercelEntryServerPath
      );
    }
  });

  let createServerBundles =
    (remixUserConfig: VitePluginConfig): VitePluginConfig["serverBundles"] =>
    ({ branch }) => {
      let config = getRouteConfig(branch);
      if (!config.runtime) {
        config.runtime = "nodejs";
      }

      if (config.runtime === "edge") {
        injectVercelEntryServer(remixUserConfig);
      }

      config = flattenAndSort(config);
      let id = `${config.runtime}-${hashConfig(config)}`;
      if (!bundleConfigs.has(id)) {
        bundleConfigs.set(id, config);
      }
      return id;
    };

  let buildEnd: VitePluginConfig["buildEnd"] = ({
    buildManifest,
    remixConfig,
    viteConfig
  }) => {
    // Clean up any modifications to the `entry.server` files
    if (vercelEntryServerPath) {
      rmSync(vercelEntryServerPath);
      if (originalEntryServerPath && originalEntryServerContents) {
        writeFileSync(originalEntryServerPath, originalEntryServerContents);
      }
    }

    if (buildManifest?.serverBundles && bundleConfigs.size) {
      for (let bundle of Object.values(buildManifest.serverBundles)) {
        let bundleWithConfig = {
          ...bundle,
          config: bundleConfigs.get(bundle.id),
        };
        buildManifest.serverBundles[bundle.id] = bundleWithConfig;
      }
    }

    if (buildManifest?.routes && routeConfigs.size) {
      for (let route of Object.values(buildManifest.routes)) {
        let routeWithConfig = {
          ...route,
          config: routeConfigs.get(route.id),
        };
        buildManifest.routes[route.id] = routeWithConfig;
      }
    }

    let assetsDir = viteConfig?.build?.assetsDir;

    let json = JSON.stringify(
      {
        buildManifest,
        remixConfig,
        viteConfig: assetsDir
          ? {
              build: {
                assetsDir,
              },
            }
          : undefined,
      },
      null,
      2
    );

    mkdirSync(".vercel", { recursive: true });
    writeFileSync(".vercel/remix-build-result.json", `${json}\n`);
  };

  return {
    name: "vercel",
    remixConfig({ remixUserConfig }) {
      return {
        /**
         * Invoked once per leaf route. Reads the `export const config`
         * of the route file (and all parent routes) and hashes the
         * combined config to determine the server bundle ID.
         */
        serverBundles:
          remixUserConfig.ssr !== false
            ? createServerBundles(remixUserConfig)
            : undefined,

        /**
         * Invoked at the end of the `remix vite:build` command.
         *   - Clean up the `entry.server` file if one was copied.
         *   - Serialize the `buildManifest` and `remixConfig` objects
         *     to the `.vercel/remix-build-result.json` file, including
         *     the static configs parsed from each route and server bundle.
         */
        buildEnd,
      };
    },
  };
}
