import { build, context, stop } from "npm:esbuild@0.28.2";

const watch = Deno.args.includes("--watch");

async function runBuild(): Promise<void> {
  await build({
    bundle: true,
    entryPoints: ["src/main.ts"],
    external: ["obsidian"],
    format: "cjs",
    logLevel: "info",
    minify: !watch,
    outfile: "main.js",
    sourcemap: watch ? "inline" : false,
    target: ["es2022"],
  });
}

if (watch) {
  await runBuild();
  const ctx = await context({
    bundle: true,
    entryPoints: ["src/main.ts"],
    external: ["obsidian"],
    format: "cjs",
    logLevel: "info",
    outfile: "main.js",
    sourcemap: "inline",
    target: ["es2022"],
  });
  await ctx.watch();
  console.log("watching src/main.ts...");
} else {
  await runBuild();
}

stop();
