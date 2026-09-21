module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  rules: {
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-console': 'off',
    'prefer-const': 'error',
    'no-var': 'error',
    'eqeqeq': ['error', 'always'],
    /**
     * Off, deliberately.
     *
     * The rule exists to stop people serialising independent async work that
     * could have run concurrently. Browser automation is the opposite case: the
     * steps ARE ordered, because each one depends on the state the last one left
     * the page in. You cannot fill a field and click its button in parallel.
     *
     * Left as a warning it produced 183 of them, none actionable — and a
     * codebase where every lint run prints 183 warnings is a codebase where
     * nobody reads the one that matters.
     */
    'no-await-in-loop': 'off',
  },
  env: {
    node: true,
    es2022: true,
  },
  ignorePatterns: ['node_modules/', 'dist/', 'playwright-report/', 'test-results/'],
};
