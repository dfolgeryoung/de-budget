import { getRequestListener } from "@hono/node-server";
import { app } from "../src/server/app.js";

// Vercel's Node runtime calls (req, res); getRequestListener bridges that to Hono's fetch handler.
export const config = { api: { bodyParser: false } };

export default getRequestListener(app.fetch);
