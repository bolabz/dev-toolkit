import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import jsdoc from 'eslint-plugin-jsdoc';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['dist/', 'node_modules/', 'eslint.config.js', 'commitlint.config.js'],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          disallowTypeAnnotations: true,
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        {
          allowNumber: true,
          allowBoolean: true,
        },
      ],
      'no-eval': 'error',

      // --- Exhaustiveness & consistency ---
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/consistent-type-exports': [
        'error',
        { fixMixedExportsWithInlineTypeSpecifier: true },
      ],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/method-signature-style': ['error', 'property'],
      // Zod forces type aliases; codebase uses both type and interface intentionally
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/no-useless-empty-export': 'error',

      // --- Strictness ---
      'no-console': 'error',
      '@typescript-eslint/strict-boolean-expressions': 'error',
      '@typescript-eslint/prefer-readonly': 'error',
      '@typescript-eslint/require-array-sort-compare': 'error',
      'no-param-reassign': ['error', { props: true, ignorePropertyModificationsFor: [] }],
      'no-return-assign': 'error',
      curly: ['error', 'all'],
      'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-implicit-coercion': 'error',
      'no-lonely-if': 'error',

      // --- Safety ---
      '@typescript-eslint/no-shadow': 'error',
      '@typescript-eslint/no-deprecated': 'error',
      'no-new-func': 'error',

      // --- Modern syntax ---
      'object-shorthand': 'error',
      'prefer-template': 'error',
      'prefer-object-spread': 'error',
      'prefer-spread': 'error',
      'prefer-rest-params': 'error',
      'prefer-arrow-callback': 'error',
      'no-unneeded-ternary': 'error',
      'no-else-return': 'error',

      // --- TypeScript consistency ---
      '@typescript-eslint/consistent-indexed-object-style': ['error', 'record'],
      '@typescript-eslint/consistent-generic-constructors': ['error', 'constructor'],
      '@typescript-eslint/prefer-find': 'error',
      '@typescript-eslint/prefer-regexp-exec': 'error',
    },
  },
  // Logger is the one file allowed to use console.error (it IS the logging layer)
  {
    files: ['src/shared/logger.ts'],
    rules: {
      'no-console': ['error', { allow: ['error'] }],
    },
  },
  // Test files: allow empty functions (used in vi.spyOn().mockImplementation(() => {}))
  // and no-console (tests may assert on console output)
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-empty-function': 'off',
      'no-console': 'off',
    },
  },
  // JSDoc enforcement for TypeScript files
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [jsdoc.configs['flat/recommended-typescript-error']],
    rules: {
      // --- Requirements ---
      'jsdoc/require-jsdoc': [
        'error',
        {
          publicOnly: true,
          require: {
            FunctionDeclaration: true,
            MethodDefinition: true,
            ClassDeclaration: true,
            ArrowFunctionExpression: false,
            FunctionExpression: false,
          },
          contexts: [
            'TSInterfaceDeclaration',
            'TSTypeAliasDeclaration',
            'TSEnumDeclaration',
            'ExportNamedDeclaration > VariableDeclaration',
          ],
        },
      ],
      'jsdoc/require-description': 'error',
      'jsdoc/require-param': 'error',
      'jsdoc/require-param-description': 'error',
      'jsdoc/require-returns': 'error',
      'jsdoc/require-returns-description': 'error',

      // --- Quality ---
      'jsdoc/informative-docs': 'error',

      // --- TypeScript-specific ---
      'jsdoc/no-types': 'error',
      'jsdoc/require-param-type': 'off',
      'jsdoc/require-returns-type': 'off',
      'jsdoc/require-property-type': 'off',

      // --- Tag validation ---
      'jsdoc/check-tag-names': [
        'error',
        {
          typed: true,
          definedTags: ['remarks', 'typeParam', 'internal', 'packageDocumentation'],
        },
      ],

      // --- Style ---
      'jsdoc/require-hyphen-before-param-description': ['error', 'always'],
      // Disabled: conflicts with Prettier's JSDoc formatting
      'jsdoc/check-alignment': 'off',
    },
  },
  // Disable ESLint rules that conflict with Prettier (must be last)
  eslintConfigPrettier,
);
