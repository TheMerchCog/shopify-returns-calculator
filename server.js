import { createRequestHandler } from "@remix-run/express";
import express from "express";

const viteDevServer =
  process.env.NODE_ENV === "production"
    ? undefined
    : await import("vite").then((vite) =>
        vite.createServer({
          server: { middlewareMode: true },
        })
      );

const app = express();

// Handle asset requests
if (viteDevServer) {
  app.use(viteDevServer.middlewares);
} else {
  app.use(
    "/assets",
    express.static("build/client/assets", { immutable: true, maxAge: "1y" })
  );
}
app.use(express.static("build/client", { maxAge: "1h" }));

// Handle all app requests
app.all(
  "*",
  createRequestHandler({
    build: await import("./build/server/index.js"),
  })
);

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
const host = "0.0.0.0";

app.listen(port, host, () => {
  console.log(`🚀 Express server listening on http://${host}:${port}`);
});