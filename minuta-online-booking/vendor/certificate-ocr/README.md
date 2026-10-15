# Certificate OCR assets

Lazy, same-origin Tesseract.js runtime for certificate layout suggestions. No CDN, external OCR endpoint or image upload is used by recognition. Images remain in the browser until the user explicitly saves a template to the existing certificate repository.

Pinned upstream packages, downloaded as tarballs without running install scripts and checked against their npm SHA-512 integrity:

- [Tesseract.js 6.0.1](https://registry.npmjs.org/tesseract.js/6.0.1): `sha512-/sPvMvrCtgxnNRCjbTYbr7BRu0yfWDsMZQ2a/T5aN/L1t8wUQN6tTWv6p6FwzpoEBA0jrN2UD2SX4QQFRdoDbA==`
- [Tesseract.js-core 6.1.2](https://registry.npmjs.org/tesseract.js-core/6.1.2): `sha512-pv4GjmramjdObhDyR1q85Td8X60Puu/lGQn7Kw2id05LLgHhAcWgnz6xSdMCSxBMWjQDmMyDXPTC2aqADdpiow==`
- `rus` and `eng` integer LSTM models: [naptha/tessdata, commit 806cd9a](https://github.com/naptha/tessdata/tree/806cd9adc8c6e8abc11c782db1818c990576bebc/4.0.0_best_int).

All four core builds are retained as required by [upstream local installation](https://github.com/naptha/tesseract.js/blob/v6.0.1/docs/local-installation.md), so runtime selects SIMD according to the device. SHA-256 checksums for copied files are in `manifest.json`; tests verify them. The upstream Apache-2.0 licenses and bundled third-party notices are included. Vendor files are unchanged; nested `.gitattributes` preserves their exact bytes across Windows/Linux.

Total vendor footprint is approximately 23.3 MB. A cold recognition loads only the selected LSTM core (approximately 4 MB), runtime/worker and two language models (approximately 5.6 MB), approximately 9.8 MB in total. These assets must not enter mandatory startup/precache. Worker uses a same-origin external script, `workerBlobURL:false`, and no persistent language cache. Tests exercise the actual provider CSP without relaxing it. Worker terminates after detection; cancellation and session changes discard the result. Physical Android memory/performance remains unverified.

Detection is a suggestion based on readable Russian/English field labels and empty horizontal writing lines. Unsupported layouts, unreadable labels, already filled areas and ambiguity fall back to manual positioning. It does not erase existing text, promise universal recognition, infer client data, or issue a certificate. User reviews the preview and explicitly saves the layout.
