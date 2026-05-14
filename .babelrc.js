// react-refresh/babel is intentionally NOT included here.
// It is wired up in webpack.renderer.config.js (gated on argv.mode === 'development'),
// which is the single source of truth. Adding it here too caused production builds
// to leak `$RefreshSig$` references and crash the renderer with a ReferenceError.
module.exports = {
  presets: [
    '@babel/preset-react',
    '@babel/preset-typescript',
  ],
};
