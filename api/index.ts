import { handle } from "hono/vercel";
import { app } from "../src/server/app";

export const config = { runtime: "nodejs" };

export default handle(app);
