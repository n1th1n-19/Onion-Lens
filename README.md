# Onion Lens — Color Picker & Screenshot

A browser extension that picks colors from any web page and takes screenshots. It's a single Manifest V3 codebase with no build step and no dependencies, and it runs in Chrome, Edge, Brave, Opera, Vivaldi, Firefox and (after conversion) Safari.

## Features

**Color picker**
- On-page eyedropper with a zoomable pixel loupe. Use the mouse wheel to zoom, arrow keys to move one pixel at a time (hold Shift for 10), Shift+click to pick several colors in a row, and Esc to exit.
- Sample size: a single pixel, or the average of a 3×3 or 5×5 area.
- 10 formats: HEX, RGB, HSL, HSV, HWB, CMYK, LAB, LCH, OKLAB, OKLCH. Click any value to copy it.
- The input box accepts any CSS color (names, `oklch()`, `color(display-p3 …)` and so on). There's also an opacity slider and the nearest CSS color name.
- Harmonies: complementary, analogous, triadic, split, tetradic, tints, shades and tones.
- Gradient builder (linear, radial or conic) with copyable CSS and in-between steps.
- WCAG contrast checker with AA/AAA badges. A **Fix** button finds the closest color that passes. It also previews how the color looks with protanopia, deuteranopia, tritanopia and achromatopsia.
- Page tools:
  - **Inspect element** shows an element's text, background and border colors plus its contrast ratio.
  - **Scan page** lists every color the page uses, sorted by how often it appears.
  - Click a scanned color to highlight every element that uses it.
- History of the last 50 colors. Palettes can be exported as CSS variables, SCSS, Tailwind, JSON or a HEX list.

**Screenshots**
- Capture modes:
  - **Visible**: what's on screen.
  - **Full page**: the whole page, scrolled and stitched together. Sticky headers are hidden after the first tile so they don't repeat.
  - **Select area**: drag a box. The page scrolls automatically when you drag to an edge.
  - **Element / container**: hover to highlight an element, and use the wheel or ↑/↓ to move to its parent or child. It captures the whole element even when it's taller than the screen.
- Optional 3, 5 or 10 second delay, for capturing hover menus.
- After capture you can **open it in the editor**, **copy it to the clipboard** or **save it as a picture**. Pictures save as PNG or JPEG to `Downloads/Onion Lens/`. Turn on "Ask where to save" to choose another folder, such as Pictures.
- Editor tools: crop, rectangle, arrow, pen, highlighter, text, pixelate/redact, eyedropper, undo and redo. It also pulls a palette out of the image.
- You can paste or drop any image into the editor to get its palette. You can also right-click an image on a page and choose **Extract palette from this image**.

## Shortcuts

| Keys | Action |
|---|---|
| Alt+Shift+X | Open popup |
| Alt+Shift+C | Pick color |
| Alt+Shift+S | Screenshot an area |
| Alt+Shift+F | Screenshot the full page |

To change them, go to `chrome://extensions/shortcuts` in Chrome or *Manage Extension Shortcuts* in Firefox's add-ons page.

## Install (development)

- **Chrome / Edge / Brave / Opera / Vivaldi:** open `chrome://extensions` (or `edge://extensions` in Edge), turn on *Developer mode*, click *Load unpacked* and choose this folder.
- **Firefox (121+):** open `about:debugging#/runtime/this-firefox`, click *Load Temporary Add-on…* and choose `manifest.json`.
- **Safari (macOS):** run `xcrun safari-web-extension-converter /path/to/onion-color` and build the generated Xcode project. Then enable the extension in Safari → Settings → Extensions.

## Package for stores

```sh
zip -r onion-lens.zip . -x '*.git*' -x '.remember/*' -x 'test.js' -x 'README.md'
```

You can upload the same zip to the Chrome Web Store, Edge Add-ons, Opera add-ons and Firefox AMO.

## Test

```sh
node test.js                                   # color math
npx web-ext lint --ignore-files test.js        # Firefox/AMO manifest lint
```

## Notes

- The picker reads pixels from a screenshot, not the `EyeDropper` API. EyeDropper only exists in Chromium and closes the popup.
- No host permissions are needed. `activeTab` grants access when you click the toolbar icon, use a shortcut or use the context menu.
- Browser pages (`chrome://`, `about:`, extension stores) can't be scripted. On those pages the toolbar badge shows `!`.
- Known limits:
  - Full-page shots longer than the browser's canvas limit (about 16k px tall) are cut off at the bottom, and the editor shows a note.
  - Pages that scroll an inner container instead of the window are captured as the visible area only.
- Fonts: Inter and JetBrains Mono, bundled under the SIL Open Font License (see `fonts/`).
