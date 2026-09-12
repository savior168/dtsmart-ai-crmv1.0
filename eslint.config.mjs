import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const baseDirectory = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory });

const config = [
  // Installer bundles and Python caches are generated artifacts, not project
  // source. Scanning them makes lint results non-actionable and can mask real
  // application regressions.
  { ignores: [".next/**", "node_modules/**", ".pnpm-store/**", ".tmp/**", "dist/**", "__pycache__/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default config;
