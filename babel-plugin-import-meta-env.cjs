/**
 * Minimal Babel plugin that rewrites:
 *   import.meta.env  ->  process.env
 *
 * This allows Jest (CommonJS mode) to run Vite source files that use
 * import.meta.env.VITE_* variables.
 */
module.exports = function importMetaEnvPlugin({ types: t }) {
  return {
    name: 'import-meta-env',
    visitor: {
      MetaProperty(path) {
        // Check for import.meta
        if (
          path.node.meta.name === 'import' &&
          path.node.property.name === 'meta'
        ) {
          const parent = path.parent
          // import.meta.env  ->  process.env
          if (
            t.isMemberExpression(parent) &&
            t.isIdentifier(parent.property, { name: 'env' })
          ) {
            path.parentPath.replaceWith(
              t.memberExpression(
                t.identifier('process'),
                t.identifier('env')
              )
            )
          } else {
            // import.meta (any other property) -> {}
            path.replaceWith(t.objectExpression([]))
          }
        }
      },
    },
  }
}
