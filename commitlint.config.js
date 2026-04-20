export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Scope is required and must be kebab-case (e.g. auth, mcp)
    'scope-empty': [2, 'never'],
    'scope-case': [2, 'always', 'kebab-case'],
    // Body is required — explain WHY, not just what
    'body-min-length': [2, 'always', 10],
    // Blank line between subject and body is required (upgrade from config-conventional warning)
    'body-leading-blank': [2, 'always'],
    // Blank line before footer is required
    'footer-leading-blank': [2, 'always'],
  },
};
