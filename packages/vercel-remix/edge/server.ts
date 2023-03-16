import type {
  ServerBuild,
  AppLoadContext,
  RequestHandler,
} from "@remix-run/server-runtime";
import { createRequestHandler as createRemixRequestHandler } from "@remix-run/server-runtime";

export type GetLoadContextFunction = (req: Request) => AppLoadContext;

export function createRequestHandler({
  build,
  getLoadContext,
  mode,
}: {
  build: ServerBuild;
  getLoadContext?: GetLoadContextFunction;
  mode?: string;
}): RequestHandler {
  let handleRequest = createRemixRequestHandler(build, mode);

  return (request) => {
    let loadContext = getLoadContext?.(request);
    return handleRequest(request, loadContext);
  };
}
