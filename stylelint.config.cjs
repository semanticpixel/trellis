module.exports = {
  extends: ['stylelint-config-standard'],
  plugins: ['stylelint-use-logical'],
  rules: {
    'csstools/use-logical': ['always', {
      // Width/height stay physical — they don't have a writing-mode counterpart
      // worth the indirection, and `block-size`/`inline-size` would obscure intent.
      except: ['width', 'height', 'min-width', 'min-height', 'max-width', 'max-height'],
    }],
    'selector-class-pattern': null, // CSS Modules use camelCase classes
  },
  ignoreFiles: ['dashboard/dist/**/*', 'dist/**/*', 'node_modules/**/*'],
};
