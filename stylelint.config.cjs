module.exports = {
  extends: ['stylelint-config-standard'],
  plugins: ['stylelint-use-logical'],
  rules: {
    'csstools/use-logical': ['always', {
      // Width/height stay physical — they don't have a writing-mode counterpart
      // worth the indirection, and `block-size`/`inline-size` would obscure intent.
      except: ['width', 'height', 'min-width', 'min-height', 'max-width', 'max-height'],
    }],
    'property-no-unknown': [true, {
      ignoreProperties: ['composes'],
    }],
    // CSS Modules group base, parent hover, and control state selectors by component instead of global specificity order.
    'no-descending-specificity': null,
    'selector-class-pattern': null, // CSS Modules use camelCase classes
    'value-keyword-case': ['lower', {
      ignoreKeywords: ['currentColor'],
      ignoreProperties: ['composes'],
    }],
  },
  ignoreFiles: ['dashboard/dist/**/*', 'dist/**/*', 'node_modules/**/*'],
};
