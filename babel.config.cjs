module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' }, modules: 'commonjs' }],
    ['@babel/preset-react', { runtime: 'automatic' }],
  ],
  plugins: [
    // Transforms import.meta.env.* -> process.env.* so Jest can run Vite source files
    require('./babel-plugin-import-meta-env.cjs'),
  ],
}
