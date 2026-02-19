import js from "@eslint/js";
import globals from "globals";
import json from "@eslint/json";
import { defineConfig } from "eslint/config";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import nodePlugin from "eslint-plugin-n";

export default defineConfig([
  {
    files: ["**/*.{js,mjs}"],
    plugins: { js },
    extends: ["js/recommended", nodePlugin.configs["flat/recommended-script"]],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node, ...globals.jasmine }
    },
    rules: {
      "no-unused-vars": [
        "error",
        {
          args: "all",
          argsIgnorePattern: "^_",
          ignoreRestSiblings: true
        }
      ],
      "no-shadow": "error",
      "prefer-const": "error",
      "n/file-extension-in-import": ["error", "always"],
      "n/prefer-global/url": ["error"],
      "n/prefer-node-protocol": ["error"]
    }
  },
  {
    files: ["**/*.json"],
    plugins: { json },
    language: "json/json5",
    extends: ["json/recommended"]
  },
  eslintConfigPrettier
]);
