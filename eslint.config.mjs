import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: [
      "node_modules/**",
      "public/vendor/**",
      "**/vendor/**",
      "build/**",
      "dist/**",
      "coverage/**",
      "tests/seed-data/**",
      "tests/load/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,cjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    rules: {
      "no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
      "no-undef": "error",
      "no-useless-catch": "off",
      "no-empty": ["error", { "allowEmptyCatch": true }],
    },
  },
  {
    files: ["**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    rules: {
      "no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
      "no-undef": "error",
    },
  },
];
