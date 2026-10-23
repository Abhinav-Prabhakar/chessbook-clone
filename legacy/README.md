# Legacy hand-built implementation

These files are from the first pass at the clone, when the UI was reconstructed
by hand in CSS/JS. That approach was replaced by the current snapshot-based
clone:

- `*.html` at the repo root: the real rendered application DOM
- `_build/assets/*.css`: the original production CSS
- `js/boot.js`: a small interaction layer
- `m/`: mobile captures rendered at 390 × 844

Nothing in this folder is loaded by the deployed site. It is kept only as a
record of the earlier implementation.
