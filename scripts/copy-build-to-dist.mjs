import path from "node:path";
import fse from "fs-extra";
import chalk from "chalk";

const args = process.argv.slice(2);
const tsc = process.env.CI || args.includes("--tsc");

const ROOT_DIR = process.cwd();
const PACKAGES_PATH = path.join(ROOT_DIR, "packages");
const DEFAULT_BUILD_PATH = path.join(ROOT_DIR, "build");

let activeOutputDir = DEFAULT_BUILD_PATH;
if (process.env.LOCAL_BUILD_DIRECTORY) {
  let appDir = path.resolve(process.env.LOCAL_BUILD_DIRECTORY);
  try {
    fse.readdirSync(path.join(appDir, "node_modules"));
  } catch {
    console.error(
      "Oops! You pointed `LOCAL_BUILD_DIRECTORY` to a directory that " +
        "does not have a `node_modules` folder. Please `npm install` in that " +
        "directory and try again."
    );
    process.exit(1);
  }
  activeOutputDir = appDir;
}

copyBuildToDist();

async function copyBuildToDist() {
  let buildPath = getBuildPath();
  let packages = (await getPackageBuildPaths(buildPath)).map((buildDir) => {
    let parentDir = path.basename(path.dirname(buildDir));
    let dirName = path.basename(buildDir);
    return {
      build: buildDir,
      src: path.join(
        PACKAGES_PATH,
        parentDir === "@remix-run"
          ? `remix-${dirName}`
          : parentDir === "@vercel"
          ? `vercel-${dirName}`
          : dirName
      ),
    };
  });

  // Write an export shim for @remix-run/node/globals types
  let dest = path.join(
    ".",
    "build",
    "node_modules",
    "@remix-run",
    "node",
    "globals.d.ts"
  );
  console.log(chalk.yellow(`  🛠  Writing globals.d.ts shim to ${dest}`));
  await fse.writeFile(dest, "export * from './dist/globals';");

  /** @type {Promise<void>[]} */
  let copyQueue = [];
  for (let pkg of packages) {
    try {
      let srcPath = path.join(pkg.build, "dist");
      let destPath = path.join(pkg.src, "dist");
      if (!(await fse.stat(srcPath)).isDirectory()) {
        continue;
      }
      copyQueue.push(
        (async () => {
          console.log(
            chalk.yellow(
              `  🛠  Copying ${path.relative(
                ROOT_DIR,
                srcPath
              )} to ${path.relative(ROOT_DIR, destPath)}`
            )
          );
          fse.copy(srcPath, destPath, {
            recursive: true,
          });
        })()
      );
    } catch {}
  }

  // One-off deep import copies so folks don't need to import from inside of
  // dist/.  TODO: Remove in a future major release and either get rid of the
  // deep import or manage with the package.json "exports" field
  let oneOffCopies = [
    // server-build.js built by rollup outside of dist/, need to copy to
    // packages/ dir outside of dist/
    [
      "build/node_modules/@remix-run/dev/server-build.js",
      "packages/remix-dev/server-build.js",
    ],
    ...(tsc
      ? [
          [
            "build/node_modules/@remix-run/dev/dist/server-build.d.ts",
            "build/node_modules/@remix-run/dev/server-build.d.ts",
          ],
          [
            "build/node_modules/@remix-run/dev/dist/server-build.d.ts",
            "packages/remix-dev/server-build.d.ts",
          ],
          // globals.d.ts shim written outside of dist/ in above, copy to packages/
          // dir outside of dist/
          [
            "build/node_modules/@remix-run/node/globals.d.ts",
            "packages/remix-node/globals.d.ts",
          ],
        ]
      : []),

    // `@vercel/remix` stuffs. We want "server" to be placed at the root of the package.
    ...[
      "globals.js",
      "globals.d.ts",
      "server.js",
      "server.d.ts",
      "vite.js",
      "vite.d.ts",
    ].map((name) => {
      return [
        `build/node_modules/@vercel/remix/dist/${name}`,
        `packages/vercel-remix/${name}`,
      ];
    }),
  ];

  oneOffCopies.forEach(([srcFile, destFile]) =>
    copyQueue.push(
      (async () => {
        let src = path.relative(ROOT_DIR, path.join(...srcFile.split("/")));
        let dest = path.relative(ROOT_DIR, path.join(...destFile.split("/")));
        console.log(chalk.yellow(`  🛠  Copying ${src} to ${dest}`));
        await fse.copy(src, dest);
      })()
    )
  );

  await Promise.all(copyQueue);

  // For the Vercel Remix Vite preset, the `Preset` type import needs to
  // be adjusted, since in this monorepo it's written against the source,
  // but consumers of the package will import for the `dist` compiled types.
  let vercelRemixViteTypesPath = "packages/vercel-remix/vite.d.ts";
  let vercelRemixViteTypesData = await fse.readFile(
    vercelRemixViteTypesPath,
    "utf8"
  );
  await fse.writeFile(
    vercelRemixViteTypesPath,
    vercelRemixViteTypesData.replace(
      "@remix-run/dev/vite/plugin",
      "@remix-run/dev/dist/vite/plugin"
    )
  );

  console.log(
    chalk.green(
      "  ✅ Successfully copied build files to package dist directories!"
    )
  );
}

/**
 * @param {string} moduleRootDir
 * @returns {Promise<string[]>}
 */
async function getPackageBuildPaths(moduleRootDir) {
  /** @type {string[]} */
  let packageBuilds = [];

  try {
    for (let fileName of await fse.readdir(moduleRootDir)) {
      let moduleDir = path.join(moduleRootDir, fileName);
      if (!(await fse.stat(moduleDir)).isDirectory()) {
        continue;
      }
      if (
        path.basename(moduleDir) === "@remix-run" ||
        path.basename(moduleDir) === "@vercel"
      ) {
        packageBuilds.push(...(await getPackageBuildPaths(moduleDir)));
      } else if (
        /node_modules[/\\]@remix-run[/\\]/.test(moduleDir) ||
        /node_modules[/\\]@vercel[/\\]/.test(moduleDir) ||
        /node_modules[/\\]create-remix/.test(moduleDir) ||
        /node_modules[/\\]remix/.test(moduleDir)
      ) {
        packageBuilds.push(moduleDir);
      }
    }
    return packageBuilds;
  } catch (_) {
    console.error(
      "No build files found. Run `pnpm build` before running this script."
    );
    process.exit(1);
  }
}

function getBuildPath() {
  return path.join(activeOutputDir, "node_modules");
}
