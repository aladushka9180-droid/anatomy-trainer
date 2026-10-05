# Native knowledge-base screenshots

These screenshots show the original Eldion Pro HTML, scripts, styles and Supabase SDK on an isolated localhost transport with fictional test rows. They are not evidence of a deployed or authenticated live site. The normal Pink Porcelain theme comes from the application's persisted preferences and matches the theme selected in its ordinary settings UI.

The fixture permits only explicit read RPCs, local authentication and read subscription acknowledgments. Data writes, notification sends, external HTTP and external WebSockets are unavailable. Browser service workers are blocked; CSP and the browser route allowlist prevent production access. The capture uses ordinary navigation, clicks, keyboard input, selects, local CSV file selection and scrolling. It does not modify the application's DOM, styles, renderers, clocks or source files. Only the local configuration selects the fixture transport. Lossless WebP is checked pixel-for-pixel against the raw PNG.

Run from the repository root with Node, Playwright and Sharp available through `NODE_PATH`. Set `MINUTA_BROWSER_EXECUTABLE` to an installed Chromium or Edge executable if Playwright's own browser is unavailable. Set `NATIVE_CAPTURE_EXTENDED=1` to capture the complete provider plan. The default widths are 390, 760 and 1440. `NATIVE_CAPTURE_DATE` selects the fictional booking date; otherwise the fixture chooses the next calendar day in Europe/Samara. The date must be in the future for booking controls to stay available.

```powershell
$env:NATIVE_CAPTURE_EXTENDED = '1'
node minuta-online-booking/help/tools/capture-native-local.mjs
```

The compact plan is `help/tools/native-article-shot-map.json`. Final WebP images and the capture manifest go to `help/images/native-local`. Raw PNGs, failures and transport diagnostics go to the repository's ignored `outputs/native-provider-capture` directory. Review the actual images before integration. `coverageExact` refers to the visible UI state of the mapped instructional step; it does not prove a backend operation was completed. No save, payment, refund, publication, export submission or message send is performed.

For a targeted repair, set `NATIVE_CAPTURE_KEYS` to comma-separated screen keys and `NATIVE_CAPTURE_MERGE=1` to preserve other reviewed captures with the same fixture date. Each active capture ID must have all three widths. Base calendar, weekly hours, service creation and manual/repeat booking proof frames are captured on every run. Use `NATIVE_CAPTURE_OUTPUT` for an independent exploratory run; never integrate unreviewed probes.

`fixtureDate` is the fictional appointment date; `capturedAt` is the package creation time. Compact transport counters describe the latest pass; `capturePasses` preserves earlier pass totals when captures are merged. The earlier passes encountered optional unsupported reads, corrected in the final fixture. Full request logs remain in `outputs`; no pass attempted an application data write or production request. Run `help/tools/validate-native-local.mjs` to verify dimensions, SHA hashes, lossless pixels, all three widths, consistent article steps and complete provider coverage.

The saved fictional preferences select the standard custom booking-card density. Separate native captures show the text-size picker and its card-field checkboxes; the theme overview is mapped only to cabinet appearance. The result form contains an unsaved fictional cash amount of 2500; its save button is never pressed.

The weekly example deliberately uses different hours and no optional break. The original desktop day editor clips the end of an enabled break at some widths; this screenshot fixture does not repair application CSS. Tall mobile screenshots use an ordinary viewport crop above native fixed navigation rather than hiding that navigation. An instructional crop may show the booking step and the first two days rather than all seven rows.

The separate client capture fixes its fixture clock at `2026-10-05T07:00:00Z` for deterministic instructional examples. This is declared in its manifest; it does not alter the original client DOM, CSS or renderer. Provider capture uses the ordinary current clock. Neither capture proves a live backend operation.
