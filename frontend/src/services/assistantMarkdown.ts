import MarkdownIt from "markdown-it";
import texmath from "markdown-it-texmath";
import * as katex from "katex";
import { colors } from "@/theme";
const markdown=new MarkdownIt({html:false,breaks:true,linkify:false}).use(texmath,{
  engine:katex,delimiters:["dollars","brackets"],katexOptions:{output:"mathml",throwOnError:false,trust:false,maxExpand:100,maxSize:20}
});
markdown.renderer.rules.image=(tokens,index) => markdown.utils.escapeHtml(tokens[index].content);
export function assistantDocument(text:string):string {
  const content=markdown.render(text);
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'none'">
  <style>html,body{margin:0;padding:0;background:transparent;color:${colors.charcoal};font:16px/1.65 system-ui,sans-serif;overflow-wrap:anywhere}
  *{box-sizing:border-box}main{padding:4px 2px;min-width:0;max-width:100%;overflow:hidden}h1,h2,h3,h4,h5,h6{font-size:18px;line-height:1.4;margin:16px 0 8px;font-weight:650}h1:first-child,h2:first-child,p:first-child{margin-top:0}
  p{margin:0 0 12px}ul,ol{padding-left:24px;margin:8px 0 14px}li{margin:4px 0}li p{margin:0}
  pre{padding:12px;background:${colors.sageLight};border-radius:6px;white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.6 monospace}
  code{font:13px/1.6 monospace;background:${colors.sageLight};padding:2px 4px}pre code{padding:0;background:none}
  blockquote{margin:12px 0;padding-left:12px;border-left:3px solid ${colors.sage};color:${colors.charcoalMuted}}
  a{color:${colors.forest}}table{display:block;overflow-x:auto;max-width:100%;width:100%;border-collapse:collapse;font-size:14px}th,td{padding:6px;border-bottom:1px solid ${colors.line};text-align:left}
  math{font-size:1.1em;max-width:100%;overflow-x:auto}section,eqn,.katex-display{display:block;max-width:100%;padding:8px 0;margin:12px 0;overflow-x:auto}body>:last-child{margin-bottom:0}</style></head>
  <body><main id="content">${content}</main><script>
  function resize(){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({height:Math.ceil(document.getElementById('content').getBoundingClientRect().height)}));}
  new ResizeObserver(resize).observe(document.getElementById('content'));window.addEventListener('load',resize);resize();
  </script></body></html>`;
}
