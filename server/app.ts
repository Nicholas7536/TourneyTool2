import dotenv from "dotenv";
import path from "node:path";

for (const envFile of [
  path.resolve(process.cwd(), ".env.local"),
  path.resolve(process.cwd(), ".env"),
]) {
  dotenv.config({ path: envFile });
}

import express from "express";
import { acquireRoomLock } from "./db.js";
import roomsRouter from "./routes/rooms.js";
import harnessRouter from "./routes/harness.js";

const app = express();
app.use(express.json({ limit: "32kb" }));

// Per-room mutex: serialises concurrent requests to the same room.
app.use("/api/rooms/:roomCode", async (request, response, next) => {
  const release = await acquireRoomLock(request.params.roomCode);
  let released = false;
  const unlock = () => {
    if (released) return;
    released = true;
    release();
  };
  response.once("finish", unlock);
  response.once("close", unlock);
  next();
});

app.use("/api/rooms", roomsRouter);
app.use("/api/test-harness", harnessRouter);

export default app;
