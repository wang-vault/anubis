import js from "@eslint/js";
import tseslint from "typescript-eslint";

/** Konfigurasi ESLint flat (ESLint 9+) — cek dasar TypeScript tanpa plugin Next. */
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [".next/**", "node_modules/**", "dist/**", "coverage/**"],
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      // Directive eslint-disable untuk plugin Next/React yang tidak terpasang di sini.
      // Biarkan sebagai no-op agar komentar existing tidak memecah lint.
    },
    linterOptions: {
      // Abaikan directive untuk rule yang tidak didefinisikan (next/react-hooks).
      reportUnusedDisableDirectives: "off",
    },
  },
);
