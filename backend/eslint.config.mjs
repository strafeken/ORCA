import js from '@eslint/js'
import globals from 'globals'
import security from 'eslint-plugin-security'
import securityNode from 'eslint-plugin-security-node'
import noUnsanitized from 'eslint-plugin-no-unsanitized'

export default [
  {
    ignores: ['node_modules/**'],
  },
  js.configs.recommended,
  security.configs.recommended,
  {
    files: ['**/*.js'],
    plugins: {
      'security-node': securityNode,
      'no-unsanitized': noUnsanitized,
    },
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      ...securityNode.configs.recommended.rules,
      'no-unsanitized/method': 'error',
      'no-unsanitized/property': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.test.js', '**/*.spec.js', '**/__tests__/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
  },
]
