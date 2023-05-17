import * as path from "path";

import type { Context } from "./context";
import * as CSS from "./css";
import * as JS from "./js";
import * as Server from "./server";
import * as Channel from "../channel";
import type { Manifest } from "../manifest";
import { create as createManifest, write as writeManifest } from "./manifest";
import { err, ok } from "../result";

type Compiler = {
  compile: (options?: {
    onManifest?: (manifest: Manifest) => void;
  }) => Promise<Manifest>;
  cancel: () => Promise<void>;
  dispose: () => Promise<void>;
};

export let create = async (ctx: Context): Promise<Compiler> => {
  // channels _should_ be scoped to a build, not a compiler
  // but esbuild doesn't have an API for passing build-specific arguments for rebuilds
  // so instead use a mutable reference (`channels`) that is compiler-scoped
  // and gets reset on each build
  let channels = {
    cssBundleHref: undefined as unknown as Channel.Type<string | undefined>,
    manifest: undefined as unknown as Channel.Type<Manifest>,
  };

  let serverBundles = Array.isArray(ctx.config.serverBundles)
    ? ctx.config.serverBundles
    : [
        {
          serverBuildPath: ctx.config.serverBuildPath,
          routes: ctx.config.routes,
        },
      ];

  let subcompiler = {
    css: await CSS.createCompiler(ctx),
    js: await JS.createCompiler(ctx, channels),
    serverBundles: await Promise.all(
      serverBundles.map(({ routes, serverBuildPath }) =>
        Server.createCompiler(ctx, routes, serverBuildPath, channels)
      )
    ),
  };
  let cancel = async () => {
    // resolve channels with error so that downstream tasks don't hang waiting for results from upstream tasks
    channels.cssBundleHref.err();
    channels.manifest.err();

    // optimization: cancel tasks
    await Promise.all([
      subcompiler.css.cancel(),
      subcompiler.js.cancel(),
      ...subcompiler.serverBundles.map((server) => server.cancel()),
    ]);
  };

  let compile = async (
    options: { onManifest?: (manifest: Manifest) => void } = {}
  ) => {
    let error: unknown | undefined = undefined;
    let errCancel = (thrown: unknown) => {
      if (error === undefined) {
        error = thrown;
      }
      cancel();
      return err(thrown);
    };

    // reset channels
    channels.cssBundleHref = Channel.create();
    channels.manifest = Channel.create();

    // kickoff compilations in parallel
    let tasks = {
      css: subcompiler.css.compile().then(ok, errCancel),
      js: subcompiler.js.compile().then(ok, errCancel),
      serverBundles: subcompiler.serverBundles.map((server) =>
        server.compile().then(ok, errCancel)
      ),
    };

    // keep track of manually written artifacts
    let writes: Promise<void>[] = [];

    // css compilation
    let css = await tasks.css;
    if (!css.ok) throw error ?? css.error;

    // css bundle
    let cssBundleHref =
      css.value.bundle &&
      ctx.config.publicPath +
        path.relative(
          ctx.config.assetsBuildDirectory,
          path.resolve(css.value.bundle.path)
        );
    channels.cssBundleHref.ok(cssBundleHref);
    if (css.value.bundle) {
      writes.push(CSS.writeBundle(ctx, css.value.outputFiles));
    }

    // js compilation (implicitly writes artifacts/js)
    let js = await tasks.js;
    if (!js.ok) throw error ?? js.error;
    let { metafile, hmr } = js.value;

    // artifacts/manifest
    let manifest = await createManifest({
      config: ctx.config,
      cssBundleHref,
      metafile,
      hmr,
    });
    channels.manifest.ok(manifest);
    writes.push(writeManifest(ctx.config, manifest));
    options.onManifest?.(manifest);

    // server compilation
    await Promise.all(
      tasks.serverBundles.map(async (promise, i) => {
        let server = await promise;
        if (!server.ok) throw error ?? server.error;
        // artifacts/server
        let { serverBuildPath } = serverBundles[i];
        writes.push(Server.write(ctx.config, serverBuildPath, server.value));
      })
    );

    await Promise.all(writes);
    return manifest;
  };
  return {
    compile,
    cancel,
    dispose: async () => {
      await Promise.all([
        subcompiler.css.dispose(),
        subcompiler.js.dispose(),
        ...subcompiler.serverBundles.map((server) => server.dispose()),
      ]);
    },
  };
};
