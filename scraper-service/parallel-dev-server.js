"use strict";

/**
 * Local dev server for the parallel frontend stack (npm run dev:parallel).
 * Serves the same legacy Express app as server.js (all /api/*, /view-file, sessions)
 * plus planning routes under /__future.
 *
 * Does not listen on PORT (3001); uses PARALLEL_PORT or 3002.
 *
 * Usage:
 *   node parallel-dev-server.js
 *   PARALLEL_PORT=3002 node parallel-dev-server.js
 *
 * Try: GET http://localhost:3002/__future/health
 */

const futureRoutes = require("./app/routes/index.js");
/** Full app: createSharedHttpApp() in server.js, then all other routes on the same instance. */
const { app } = require("./server.js");

app.use("/__future", futureRoutes);

const port = Number(process.env.PARALLEL_PORT || 3002);

app.listen(port, "0.0.0.0", () => {
  console.log(
    `[parallel-app] listening on http://localhost:${port} (legacy /api/* + /__future/*)`,
  );
});
