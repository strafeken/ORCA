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
      // Known bug in eslint-plugin-security-node@1.1.4: this rule throws a
      // TypeError while traversing method-chained EventEmitter calls (e.g. the
      // ffmpeg().on('error',...).on('end',...) chain in utils/audio.js), which
      // aborts the whole lint run. The chained handlers already handle the
      // 'error' event, so the rule adds no value here — disable it until the
      // upstream fix lands.
      'security-node/detect-unhandled-event-errors': 'off',
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
