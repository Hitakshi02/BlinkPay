// packages/server/src/index.ts
import express from "express";
import cors from "cors";
import { ENV } from "./env";
import sessionsRouter from "./routes/sessions";

const app = express();

// --- CORS: allow your Next.js app to call this API
app.use(
  cors({
    origin: ["http://localhost:3000"], // add more origins if needed
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Parse JSON bodies
app.use(express.json());

// Optional: respond to Chrome DevTools probe to avoid noisy 404
app.get(
  "/.well-known/appspecific/com.chrome.devtools.json",
  (_req, res) => res.status(200).json({ ok: true })
);

// Healthcheck
app.get("/health", (_req, res) =>
  res.json({ ok: true, ts: Date.now(), env: ENV.NODE_ENV })
);

// Your session routes
app.use("/sessions", sessionsRouter);

// Basic error handler (so you see JSON instead of a silent exit)
app.use(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[server] error:", err);
    res.status(500).json({ ok: false, error: err?.message ?? "internal error" });
  }
);

const port = Number(ENV.PORT || 4000);
app.listen(port, () => {
  console.log(`[server] listening on http://localhost:${port} (${ENV.NODE_ENV})`);
});
