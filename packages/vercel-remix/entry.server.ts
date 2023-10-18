import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import isbot from "isbot";
import { createReadableStreamFromReadable } from "@remix-run/node";

const ABORT_DELAY = 5000;

export function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixServer: JSX.Element
) {
  // If the request is from a bot, we want to wait for the full
  // response to render before sending it to the client. This
  // ensures that bots can see the full page content.
  if (isbot(request.headers.get("user-agent"))) {
    return serveTheBots(responseStatusCode, responseHeaders, remixServer);
  }

  return serveBrowsers(responseStatusCode, responseHeaders, remixServer);
}

function serveTheBots(
  responseStatusCode: number,
  responseHeaders: Headers,
  remixServer: JSX.Element
) {
  return new Promise((resolve, reject) => {
    let { pipe, abort } = renderToPipeableStream(remixServer, {
      // Use onAllReady to wait for the entire document to be ready
      onAllReady() {
        responseHeaders.set("Content-Type", "text/html");
        let body = new PassThrough();
        let stream = createReadableStreamFromReadable(body);

        resolve(
          new Response(stream, {
            status: responseStatusCode,
            headers: responseHeaders,
          })
        );

        pipe(body);
      },
      onShellError(err) {
        reject(err);
      },
    });
    setTimeout(abort, ABORT_DELAY);
  });
}

function serveBrowsers(
  responseStatusCode: number,
  responseHeaders: Headers,
  remixServer: JSX.Element
) {
  return new Promise((resolve, reject) => {
    let didError = false;
    let { pipe, abort } = renderToPipeableStream(remixServer, {
      // use onShellReady to wait until a suspense boundary is triggered
      onShellReady() {
        responseHeaders.set("Content-Type", "text/html");
        let body = new PassThrough();
        let stream = createReadableStreamFromReadable(body);

        resolve(
          new Response(stream, {
            status: didError ? 500 : responseStatusCode,
            headers: responseHeaders,
          })
        );

        pipe(body);
      },
      onShellError(err) {
        reject(err);
      },
      onError(err) {
        didError = true;
        console.error(err);
      },
    });
    setTimeout(abort, ABORT_DELAY);
  });
}
