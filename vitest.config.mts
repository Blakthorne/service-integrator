import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
    plugins: [tsconfigPaths()],
    css: {
        postcss: {},
    },
    // tsconfig uses `jsx: "preserve"` for Next; tests need esbuild to compile TSX.
    esbuild: {
        jsx: "automatic",
    },
    resolve: {
        alias: [
            {
                // The real package throws when imported outside a React Server
                // environment; Next aliases it itself, so tests use an empty stub.
                find: /^server-only$/,
                replacement: fileURLToPath(
                    new URL("./test/stubs/server-only.ts", import.meta.url)
                ),
            },
        ],
    },
    test: {
        environment: "node",
        include: ["**/*.test.ts"],
        // .claude/** holds agent git worktrees (full repo copies) — never test them.
        exclude: ["node_modules/**", ".next/**", ".claude/**"],
    },
});
