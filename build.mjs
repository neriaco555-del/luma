import { build } from "esbuild";
import { cpSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
await build({
  entryPoints: ["src/background.ts", "src/panel.ts", "src/options.ts"],
  bundle: true,
  format: "iife",
  target: "chrome120",
  outdir: "dist",
});
cpSync("static", "dist", { recursive: true });
cpSync("manifest.json", "dist/manifest.json");
