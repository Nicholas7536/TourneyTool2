import express from "express";
import path from "node:path";
import app from "./app";

const publicDir = path.resolve(process.cwd(), "dist/public");
const port = Number(process.env.PORT || 3000);

app.use(express.static(publicDir));
app.use((request, response, next) => {
  if (request.method === "GET" && !request.path.startsWith("/api/")) {
    response.sendFile(path.join(publicDir, "index.html"));
    return;
  }
  next();
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Strikers Tournament server listening on port ${port}`);
});
