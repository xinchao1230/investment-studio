/**
 * Ambient declarations for Univer plugin locale dictionary subpaths.
 *
 * Each Univer plugin ships its locale bundles under `<pkg>/lib/locale/<locale>.js`
 * but does NOT publish accompanying `.d.ts` files (and the package's `exports`
 * map doesn't enumerate every locale subpath either). We dynamically `import`
 * them from `UniverSheet.tsx` to build the merged locales dictionary, and
 * Vite resolves them at runtime — but the Webpack/TS build refuses without
 * type declarations.
 *
 * We declare them as `any` (the runtime shape is a nested object that gets
 * fed straight into `Tools.deepMerge`).
 */
declare module '@univerjs/design/lib/locale/zh-CN' {
  const locale: any;
  export default locale;
}
declare module '@univerjs/ui/lib/locale/zh-CN' {
  const locale: any;
  export default locale;
}
declare module '@univerjs/docs-ui/lib/locale/zh-CN' {
  const locale: any;
  export default locale;
}
declare module '@univerjs/sheets/lib/locale/zh-CN' {
  const locale: any;
  export default locale;
}
declare module '@univerjs/sheets-ui/lib/locale/zh-CN' {
  const locale: any;
  export default locale;
}
declare module '@univerjs/sheets-formula/lib/locale/zh-CN' {
  const locale: any;
  export default locale;
}
