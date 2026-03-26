import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile } from "fs/promises";

const externalOnly = [
  "sharp",
  "pg",
  "@google-cloud/storage",
  "google-auth-library",
  "bufferutil",
  "stripe-replit-sync",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  process.env.VITE_CLERK_PUBLISHABLE_KEY = "__RUNTIME__";

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) =>
    externalOnly.some((ext) => dep === ext || dep.startsWith(ext + "/"))
  );
  console.log(`Bundling ${allDeps.length - externals.length} deps, ${externals.length} external: ${externals.join(", ")}`);

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    banner: {
      js: [
        `var __import_meta_url = require("url").pathToFileURL(__filename).href;`,
      ].join(""),
    },
    define: {
      "process.env.NODE_ENV": '"production"',
      "import.meta.url": "__import_meta_url",
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
