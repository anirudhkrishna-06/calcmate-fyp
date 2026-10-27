declare module "markdown-it-texmath" {
  import { PluginWithOptions } from "markdown-it";
  import { KatexOptions } from "katex";
  const plugin:PluginWithOptions<{ delimiters?:string[]; engine?:typeof import("katex"); katexOptions?:KatexOptions }>;
  export default plugin;
}
