// Interop tests: verifies the published artifact (`npm pack`) works from every
// consumer flavor we support, using only Node and the local devDependencies.
// Run with `npm run test:interop` after `npm run build`.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(rootDir, "dist");
const isWindows = process.platform === "win32";
const npmCmd = isWindows ? "npm.cmd" : "npm";
const tscBinary = join(
    rootDir,
    "node_modules",
    ".bin",
    isWindows ? "tsc.cmd" : "tsc"
);

if (
    !existsSync(join(distDir, "index.js")) ||
    !existsSync(join(distDir, "index.d.cts")) ||
    !existsSync(join(distDir, "esm", "index.js"))
) {
    console.error("dist/ is missing. Run `npm run build` first.");
    process.exit(1);
}

const tempDir = mkdtempSync(join(tmpdir(), "rate-keeper-interop-"));
let checks = 0;

/** Runs a command inside the temporary consumer project. */
function run(command, args, options = {}) {
    return execFileSync(command, args, {
        cwd: tempDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        shell: isWindows,
        ...options,
    });
}

function check(name, fn) {
    try {
        fn();
        checks += 1;
        console.log(`ok - ${name}`);
    } catch (error) {
        console.error(`FAIL - ${name}`);
        throw error;
    }
}

try {
    // 1. Pack the exact artifact that `npm publish` would upload and install
    //    it in the temporary project, like a real consumer would.
    const packOutput = run(npmCmd, ["pack", "--json", "--pack-destination", tempDir], {
        cwd: rootDir,
    });
    // npm <= 11 returns an array; npm >= 12 returns an object keyed by name.
    const packResult = JSON.parse(packOutput);
    const packInfo = Array.isArray(packResult) ? packResult[0] : Object.values(packResult)[0];
    const tarball = join(tempDir, packInfo.filename);

    writeFileSync(
        join(tempDir, "package.json"),
        JSON.stringify({ name: "interop-check", private: true }, null, 2) + "\n"
    );
    run(npmCmd, [
        "install",
        "--no-audit",
        "--no-fund",
        "--ignore-scripts",
        "--loglevel=error",
        tarball,
    ]);

    // 2. Fixtures. Bundle fixtures avoid Node built-ins so esbuild can target
    //    the browser platform.
    writeFileSync(
        join(tempDir, "esm.mjs"),
        `import assert from "node:assert/strict";
import RateKeeper, { DropPolicy } from "rate-keeper";

assert.equal(typeof RateKeeper, "function", "default import must be callable");
assert.equal(DropPolicy.DropOldest, 1, "named export DropPolicy must be usable");

const keeper = RateKeeper((value) => value + 1, 0);
assert.equal(await keeper(41), 42);

console.log("esm ok");
`
    );

    writeFileSync(
        join(tempDir, "cjs.cjs"),
        `const assert = require("node:assert/strict");
const RateKeeper = require("rate-keeper");

assert.equal(typeof RateKeeper, "function", "require() must be callable");
assert.equal(typeof RateKeeper.default, "function", "require().default must be callable");
assert.equal(RateKeeper.default, RateKeeper, "require().default must be the same function");
assert.equal(RateKeeper.DropPolicy.DropOldest, 1, "require().DropPolicy must be usable");

(async () => {
    const keeper = RateKeeper((value) => value + 2, 0);
    assert.equal(await keeper(40), 42);
    console.log("cjs ok");
})();
`
    );

    writeFileSync(
        join(tempDir, "bundle-esm-entry.mjs"),
        `import RateKeeper, { DropPolicy } from "rate-keeper";

if (typeof RateKeeper !== "function") throw new Error("default import is not callable");
if (DropPolicy.DropOldest !== 1) throw new Error("named export DropPolicy is missing");

const keeper = RateKeeper((value) => value * 2, 0);
if ((await keeper(21)) !== 42) throw new Error("rate-limited call returned the wrong result");

console.log("bundle esm ok");
`
    );

    writeFileSync(
        join(tempDir, "bundle-cjs-entry.mjs"),
        `import RateKeeper, { DropPolicy } from "rate-keeper";

if (typeof RateKeeper !== "function") throw new Error("default import is not callable");
if (DropPolicy.DropOldest !== 1) throw new Error("named export DropPolicy is missing");

const keeper = RateKeeper((value) => value * 2, 0);
keeper(21).then((result) => {
    if (result !== 42) throw new Error("rate-limited call returned the wrong result");
    console.log("bundle cjs ok");
});
`
    );

    // 3. Node consumer checks.
    check("Node ESM: default and named imports work", () => {
        const stdout = run(process.execPath, ["esm.mjs"]);
        if (!stdout.includes("esm ok")) throw new Error(`unexpected output: ${stdout}`);
    });

    check("Node CJS: require() is callable and keeps .default / .DropPolicy", () => {
        const stdout = run(process.execPath, ["cjs.cjs"]);
        if (!stdout.includes("cjs ok")) throw new Error(`unexpected output: ${stdout}`);
    });

    // 4. esbuild bundle checks (the wrangler/esbuild case that regressed).
    const esbuild = await import("esbuild");
    const bundleTargets = [
        {
            name: "esbuild bundle (browser, esm)",
            platform: "browser",
            format: "esm",
            entry: "bundle-esm-entry.mjs",
            outfile: "bundle-browser.mjs",
        },
        {
            name: "esbuild bundle (node, esm)",
            platform: "node",
            format: "esm",
            entry: "bundle-esm-entry.mjs",
            outfile: "bundle-node.mjs",
        },
        {
            name: "esbuild bundle (node, cjs)",
            platform: "node",
            format: "cjs",
            entry: "bundle-cjs-entry.mjs",
            outfile: "bundle-node.cjs",
        },
    ];

    for (const target of bundleTargets) {
        await esbuild.build({
            absWorkingDir: tempDir,
            entryPoints: [target.entry],
            outfile: target.outfile,
            bundle: true,
            platform: target.platform,
            format: target.format,
            logLevel: "silent",
        });
        check(target.name, () => {
            const stdout = run(process.execPath, [target.outfile]);
            if (!stdout.includes("ok")) throw new Error(`unexpected output: ${stdout}`);
        });
    }

    // 5. Type checks against the published declarations.
    const consumerSource = `import RateKeeper, { CancelablePromise, DropPolicy, QueueSettings } from "rate-keeper";

const settings: QueueSettings = { id: 0, dropPolicy: DropPolicy.DropOldest };
const keeper: (...args: [number]) => CancelablePromise<number> = RateKeeper((value: number) => value + 1, 0);
const pending: CancelablePromise<number> = keeper(1);
pending.cancel();
void settings;
`;
    writeFileSync(join(tempDir, "consumer.ts"), consumerSource);
    writeFileSync(join(tempDir, "consumer.mts"), consumerSource);
    writeFileSync(join(tempDir, "consumer.cts"), consumerSource);

    const typeCheckTargets = [
        {
            name: "types (moduleResolution bundler)",
            file: "consumer.ts",
            module: "esnext",
            moduleResolution: "bundler",
        },
        {
            name: "types (moduleResolution nodenext, ESM)",
            file: "consumer.mts",
            module: "nodenext",
            moduleResolution: "nodenext",
        },
        {
            name: "types (moduleResolution nodenext, CJS)",
            file: "consumer.cts",
            module: "nodenext",
            moduleResolution: "nodenext",
        },
    ];

    for (const target of typeCheckTargets) {
        check(target.name, () => {
            run(tscBinary, [
                "--noEmit",
                "--strict",
                "--esModuleInterop",
                "--skipLibCheck",
                "--target", "es2022",
                "--module", target.module,
                "--moduleResolution", target.moduleResolution,
                target.file,
            ]);
        });
    }

    console.log(`\nAll interop checks passed (${checks}).`);
} finally {
    rmSync(tempDir, { recursive: true, force: true });
}
