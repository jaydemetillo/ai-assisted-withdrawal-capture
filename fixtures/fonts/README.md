# Fixture fonts

`caveat.woff2` and `indie-flower.woff2` are the Latin subsets of the Google Fonts
[Caveat](https://fonts.google.com/specimen/Caveat) and
[Indie Flower](https://fonts.google.com/specimen/Indie+Flower) families, both released
under the [SIL Open Font License 1.1](https://openfontlicense.org/).

They are committed rather than fetched at render time so `node scripts/make-fixtures.mjs`
works offline. That matters for more than convenience: if the font fetch fails silently,
the browser falls back to a serif face and the "handwriting" fixtures quietly become a
test of *printed* text, which would make the OCR results look far better than they are.
