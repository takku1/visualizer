/** esbuild inlines .glsl files as strings via the `text` loader. */
declare module '*.glsl' {
  const source: string;
  export default source;
}
