# Vendored libraries

These files are served from this site instead of a CDN, so a third-party outage or compromise can't change what runs here. To update one, install the new version with npm and copy the file over.

| File | Library | Version | License |
|---|---|---|---|
| `marked.umd.js` | [marked](https://github.com/markedjs/marked) | 18.0.14 | MIT |
| `purify.min.js` | [DOMPurify](https://github.com/cure53/DOMPurify) | 3.4.16 | MPL-2.0 or Apache-2.0 |
| `highlight.min.js` | [highlight.js](https://github.com/highlightjs/highlight.js) (cdn-assets build) | 11.12.0 | BSD-3-Clause |
| `katex/katex.min.js`, `katex/katex.min.css`, `katex/fonts/*.woff2` | [KaTeX](https://github.com/KaTeX/KaTeX) | 0.19.0 | MIT |
| `katex/auto-render.min.js` | KaTeX contrib auto-render | 0.19.0 | MIT |

Only the `.woff2` KaTeX fonts are included (every browser that runs this app supports them). The only edit to upstream files is removing the trailing `sourceMappingURL` comment from `marked.umd.js` and `purify.min.js`, since the maps aren't shipped. License texts are in `licenses/`.
