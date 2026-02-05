import js from "@eslint/js";
import globals from "globals";
import json from "@eslint/json";
import { defineConfig } from "eslint/config";
import eslintConfigPrettier from "eslint-config-prettier/flat";

export default defineConfig([
  {
    files: ["**/*.{js,mjs,cjs}"],
    plugins: { js },
    extends: ["js/recommended"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.node, ...globals.jasmine }
    },
    rules: {
      "no-unused-vars": "off",
      "no-shadow": "error"
    }
  },
  {
    files: ["**/*.js"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module" }
  },
  {
    files: ["**/*.json"],
    plugins: { json },
    language: "json/json5",
    extends: ["json/recommended"]
  },
  eslintConfigPrettier
]);
