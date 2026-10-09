// Build script: produces the CommonJS build (dist/), the callable-CommonJS
// interop footer, the matching CommonJS type surface, and the native ESM build
// (dist/esm/). See the "Module formats" section in the README.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(rootDir, "dist");
const esmDir = join(distDir, "esm");

/** Runs the local `tsc` binary from node_modules/.bin with the given project. */
function runTsc(project) {
    const tscBinary = join(
        rootDir,
        "node_modules",
        ".bin",
        process.platform === "win32" ? "tsc.cmd" : "tsc"
    );
    execFileSync(tscBinary, ["-p", project], {
        cwd: rootDir,
        stdio: "inherit",
        shell: process.platform === "win32",
    });
}

// 1. Clean previous output.
rmSync(distDir, { recursive: true, force: true });

// 2. CommonJS build (main entry, used by the `require` condition).
runTsc("tsconfig.json");

// 3. Append the callable-CommonJS interop footer. This makes
//    `require("rate-keeper")` directly callable while keeping `.default` and
//    the named exports, so every interop flavor (Node ESM, Node CJS, Babel,
//    webpack, esbuild in browser and node modes) agrees on the default.
const interopFooter = [
    "",
    "// --- CommonJS callable interop (appended by scripts/build.mjs) ---",
    "module.exports = exports.default;",
    "module.exports.default = exports.default;",
    "module.exports.DropPolicy = exports.DropPolicy;",
    "",
].join("\n");

const cjsIndexPath = join(distDir, "index.js");
const cjsCode = readFileSync(cjsIndexPath, "utf8");
const sourceMapDirective = /^\/\/# sourceMappingURL=.*$/m;

if (sourceMapDirective.test(cjsCode)) {
    // Insert the footer before the source map directive so it stays last.
    writeFileSync(
        cjsIndexPath,
        cjsCode.replace(sourceMapDirective, (match) => `${interopFooter}${match}`)
    );
} else {
    appendFileSync(cjsIndexPath, interopFooter);
}

// 4. CommonJS type surface: models the callable `module.exports` shape
//    produced by the interop footer, so TypeScript resolves both `import`
//    and `require` without an unnecessary `.default` access.
const cjsTypesTemplate = readFileSync(
    join(rootDir, "scripts", "cjs-types.d.cts.template"),
    "utf8"
);
writeFileSync(join(distDir, "index.d.cts"), cjsTypesTemplate);

// 5. Native ESM build (used by the `import` condition).
runTsc("tsconfig.esm.json");

// 6. Scope dist/esm as ESM so Node treats its .js files as ES modules.
writeFileSync(
    join(esmDir, "package.json"),
    JSON.stringify({ type: "module" }, null, 2) + "\n"
);

console.log("Build complete: dist/ (CommonJS) and dist/esm/ (ESM).");
