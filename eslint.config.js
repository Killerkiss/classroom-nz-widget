import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'release/**', 'node_modules/**', 'coverage/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // The renderer only draws. Anything privileged goes through the IPC contract.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@main/*', 'electron'], message: 'The renderer must go through window.api (see src/shared/ipc/contract.ts).' },
          ],
        },
      ],
    },
  },

  {
    // THE PURE CORE. Pure functions of (now, data, settings) — no I/O, no ambient
    // time, no timers. This is what makes the 18:00 flip and alert cadence testable.
    files: ['src/shared/core/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'setTimeout', message: 'The pure core returns nextWakeAt; only src/main/sync/scheduler.ts sets timers.' },
        { name: 'setInterval', message: 'The pure core returns nextWakeAt; only src/main/sync/scheduler.ts sets timers.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: 'Time enters through an injected Clock (src/shared/core/clock.ts).' },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: 'Time enters through an injected Clock (src/shared/core/clock.ts).' },
        { selector: "ImportDeclaration[source.value='electron']", message: 'src/shared must not import electron — it runs in both processes.' },
      ],
    },
  },

  {
    // Only the scheduler owns timers, so alert firing stays in one auditable place.
    files: ['src/main/**/*.ts'],
    ignores: ['src/main/sync/scheduler.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'setInterval', message: 'Timers belong in src/main/sync/scheduler.ts.' },
      ],
    },
  },

  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
);
