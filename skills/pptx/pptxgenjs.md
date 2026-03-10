# PPTXGenJS From Scratch

Use this path only for new decks where preserving an existing template is not required.

## Starter Pattern

```js
const pptxgen = require("pptxgenjs");

const pptx = new pptxgen();
pptx.layout = "LAYOUT_WIDE";
pptx.author = "HybridClaw";
pptx.subject = "Executive summary";
pptx.theme = {
  headFontFace: "Aptos Display",
  bodyFontFace: "Aptos",
  lang: "en-US",
};

const slide = pptx.addSlide();
slide.background = { color: "F7F4EC" };
slide.addText("Q4 Revenue Accelerated", {
  x: 0.6,
  y: 0.4,
  w: 11.4,
  h: 0.6,
  fontFace: "Aptos Display",
  fontSize: 24,
  bold: true,
  color: "18242D",
});
slide.addText(
  "Revenue grew 18% year over year, led by enterprise renewals and improved expansion in EMEA.",
  {
    x: 0.6,
    y: 1.2,
    w: 5.6,
    h: 1.0,
    fontFace: "Aptos",
    fontSize: 16,
    color: "334A57",
    breakLine: false,
  },
);

pptx.writeFile({ fileName: "exec-summary.pptx" });
```

## Layout Guidelines

- Use widescreen unless the user specifies another aspect ratio.
- Reserve the top-left for the primary message.
- Keep body copy below 40-60 words per slide.
- Use 2-3 colors consistently. Let emphasis come from hierarchy, not decoration.
- Prefer charts and key numbers over paragraph-heavy slides.
