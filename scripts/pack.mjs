import { spawnSync } from "child_process";
import { mkdirSync, readdirSync, renameSync } from "fs";

const root = new URL("..", import.meta.url);
const publicDir = new URL("public/", root);

mkdirSync(publicDir, { recursive: true });
const remixDevDir = new URL("packages/remix-dev/", root);
spawnSync("pnpm", ["pack"], { cwd: remixDevDir, stdio: "inherit" });
const remixDevTarball = readdirSync(remixDevDir).find((f) =>
  f.endsWith(".tgz")
);
if (!remixDevTarball) throw new Error("Could not find `remix-dev` tarball");
renameSync(
  new URL(remixDevTarball, remixDevDir),
  new URL("remix-dev.tgz", publicDir)
);

const vercelRemixDir = new URL("packages/vercel-remix/", root);
spawnSync("pnpm", ["pack"], { cwd: vercelRemixDir, stdio: "inherit" });
const vercelRemixTarball = readdirSync(vercelRemixDir).find((f) =>
  f.endsWith(".tgz")
);
if (!vercelRemixTarball) throw new Error("Could not find `remix-dev` tarball");
renameSync(
  new URL(vercelRemixTarball, vercelRemixDir),
  new URL("vercel-remix.tgz", publicDir)
);
