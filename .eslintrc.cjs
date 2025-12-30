module.exports = {
  root: true,
  env: {
    browser: true,
    es2020: true
  },
  globals: {
    browser: "readonly",
    chrome: "readonly"
  },
  extends: ["eslint:recommended", "prettier"],
  rules: {
    "no-empty": ["error", { allowEmptyCatch: true }]
  },
  overrides: [
    {
      files: ["**/*.ts"],
      parser: "@typescript-eslint/parser",
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: __dirname,
        sourceType: "module"
      },
      plugins: ["@typescript-eslint"],
      extends: [
        "plugin:@typescript-eslint/recommended",
        "plugin:@typescript-eslint/recommended-requiring-type-checking",
        "prettier"
      ],
      rules: {
        "@typescript-eslint/no-unused-vars": [
          "error",
          {
            argsIgnorePattern: "^_",
            caughtErrorsIgnorePattern: "^_",
            varsIgnorePattern: "^_"
          }
        ]
      }
    },
    {
      files: ["scripts/**/*.mjs"],
      env: {
        node: true
      },
      parserOptions: {
        sourceType: "module",
        ecmaVersion: "latest"
      }
    },
    {
      files: ["tests/**/*.ts", "vitest.config.ts"],
      rules: {
        "@typescript-eslint/no-unsafe-assignment": "off",
        "@typescript-eslint/no-unsafe-call": "off",
        "@typescript-eslint/no-unsafe-member-access": "off"
      }
    }
  ]
};
