# Tessera frontend playground

The frontend playground is a local UI for inspecting what the Tessera detector
would find in pasted text. Run the detector in one terminal and the frontend
in another; run these commands from the repository root:

Use Node.js `^22.22.2`, `^24.15.0`, or `>=26.0.0`; the frontend dependency
lock requires one of these supported ranges.

```bash
npm --prefix frontend install
uv run --project detector --group serve tessera serve
npm --prefix frontend run dev
```

The detector listens on `127.0.0.1:8000` by default. The Vite development
server proxies `/api` requests to that address. To use another locally running
detector, set `TESSERA_DETECTOR_URL` before starting the frontend:

```bash
TESSERA_DETECTOR_URL=http://127.0.0.1:9000 npm --prefix frontend run dev
```

## Language and example

The `Язык / Language` select offers English and Russian. English is the default;
the selection stays in memory for the current page only. Switching changes UI
labels and status messages while preserving input, accepted results, finding
selection, technical disclosure and pending requests. Detector entity types,
recognizer names, diagnostics, submitted text and replacement tokens stay as
returned or entered.

`Use example` / `Вставить пример` fills a fictional German text supported by this
detector. It is available only when the input is empty or whitespace and no
analysis is pending. It does not overwrite text or analyze automatically;
choose `Analyze text` / `Проверить текст` to send it to the local detector.
Filling the example is an ordinary edit and preserves any previous result until
Clear or a new analysis.

## Local TXT files

`Open TXT file` / `Открыть TXT` reads one UTF-8 `.txt` file locally, up to
100 KB (100,000 bytes, including a UTF-8 BOM). The filename suffix is checked
without case sensitivity; the MIME type does not matter. Malformed UTF-8,
NUL characters and empty or whitespace-only files are rejected. A UTF-8 BOM
is removed; all other Unicode, whitespace and line endings are preserved.

Opening a file fills the input without sending a request. Review the text and
choose Analyze to send it to the configured local detector. File opening is
available only for empty or whitespace input while no analysis or file read
is pending, so it cannot overwrite a draft. Typing, Clear, Use example or a
new analysis cancels any unfinished read. Clear permits opening the same file
again. A successful import preserves the previous submitted snapshot and its
filters, selected finding and technical disclosure until Analyze or Clear.

The frontend does not display or store filenames, upload files, or persist file
contents. Imported text has the same in-memory lifetime as pasted text. File
references and bytes are released after reading; there is no encoding conversion.

## NER and privacy boundary

NER weights are optional for startup. Without them, the detector runs its
deterministic layer only; `ner: false` is an honest, deterministic-only state
reported by detector health. To enable the full layer, install the `ner` and
`serve` dependency groups and download the weights with:

```bash
make model
```

The model download is optional and large. The detector can start and serve
deterministic results while weights are absent; restart it after installing
weights so the NER layer is loaded.

Pasted text is sent to the locally configured detector for inspection and is
not persisted by the frontend. Keep the detector local and do not point
`TESSERA_DETECTOR_URL` at an untrusted remote detector: that would send pasted
personal data outside the intended local privacy boundary.

## Local preview and detection coverage

After analysis, the playground shows the submitted snapshot and a selectable
pseudonymized preview computed locally from the accepted detector spans. Only
detected values are replaced; undetected personal data can remain. With no
spans, the preview is unchanged and says no replacements were made.

The finding summary counts detected occurrences by entity type, including repeated
values. Select a submitted-text highlight with a click, Enter or Space to focus
its detail row. Fragment, entity type, evidence layer and confidence are visible
by default; `Show technical details` reveals tier, recognizer and context.
Type and detection-method filters combine with AND and change only the details
table. The shown/total count and scope note distinguish no matching rows from no
detections. Summary counts, highlights, the complete preview and copied text always
include every accepted finding. Reset filters restores all rows. Selecting a hidden
highlight resets both filters and focuses its exact detail row; selecting a visible
highlight keeps the filters.

Changing or resetting filters clears the selected finding and preserves technical
disclosure. Filters and technical disclosure stay with the submitted snapshot while
editing or switching languages and reset on Clear or a new analysis. A count of
zero does not prove that no personal data is present.

Replacement tokens use `[TYPE_N]`, numbered independently by type in text order.
The same exact value and type reuse a token within one result, and numbering
restarts for each analysis. Tokens already present literally in the submitted
text are skipped. Supported current catalog types retain their names;
unsupported or unsafe labels use `ENTITY`. Unicode code-point offsets and
untouched whitespace are preserved; invalid spans produce no preview.

`Copy preview` writes exactly the transformed text through the Clipboard API
only when clicked. If copying is unavailable or denied, select the preview
text to copy manually. Editing the input preserves the submitted result;
Clear or another analysis removes it and its copy feedback. The frontend
does not persist replacement maps or copy automatically.

`Download TXT` / `Скачать TXT` starts a local download of the complete accepted
preview as `tessera-pseudonymized.txt`. Its UTF-8 plain-text bytes preserve Unicode,
whitespace and line endings exactly, without a BOM, extra newline or metadata.
Filters and draft edits do not change the exported snapshot. No findings means
the unchanged text is downloaded. Downloading requires an explicit click and
makes no extra request, clipboard write or persistent browser storage change.
The browser controls saving and cancellation; feedback confirms only that the
download started. Clear or a new analysis resets download feedback. The file
can still contain undetected personal data.

Catalog rules cover emails and supported financial and tax identifiers. NER
can detect names, locations, organizations and sensitive categories when it
runs. These are capabilities, not guarantees; phone numbers are not currently
supported. This preview does not establish full anonymization or reproduce
gateway session semantics.

The root `docker-compose.yml` does not publish detector port `8000`; only the
gateway is exposed to the host. The frontend playground therefore uses the
direct local detector command above (or another explicitly local detector),
not the Compose service from outside the Compose network. This playground has
no production deployment configuration and is not a production service.

## Quality checks

Run the complete frontend quality gate from the repository root:

```bash
cd frontend
npm run check:api
npm run typecheck
npm run lint
npm run test:run
npx playwright install chromium
npm run test:e2e
npm run build
```

Every command must exit 0. Test output should contain no React `act` warnings,
unhandled requests, or browser console errors.

Before committing frontend-only work, prove protected backend and contract
paths are untouched:

```bash
git diff --exit-code HEAD -- gateway detector docs/api/openapi.json docker-compose.yml
git status --short
```

For final verification, run all checks in one chain and inspect the branch:

```bash
cd frontend
npm run check:api && npm run typecheck && npm run lint && npm run test:run && npx playwright install chromium && npm run test:e2e && npm run build
cd ..
git status --short
git log --oneline --decorate -8
```
