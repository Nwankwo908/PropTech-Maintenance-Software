# Lease document scanning

`onboarding-document-extract` uses Gemini 3.8 Flash (`gemini-3.8-flash`). Lease recovery uses `gpt-4o-mini` after a targeted Gemini reread still leaves unreadable or conflicting fields. Existing OpenAI text helpers use `gpt-4o`. Equipment photos use the same `gpt-4o-mini` model as their backup after Gemini.

## Extraction and review

- PDFs retain their original bytes and every page, including scanned pages in mixed documents. Embedded text is supplied alongside the native PDF. High media resolution is requested. Browser preview crops do not substitute for the uploaded PDF.
- Tenant names, premises, unit, dates, rent, deposit and due day have individual status, confidence, original page references and supporting quotes. Impossible dates, negative amounts, invalid due days, weak citations and reversed date ranges require review. Explicit zero deposit is valid.
- `not_stated` means the supplied pages were checked and the term was absent. `unreadable` means extraction failed. Missing tenant, premises, start date or rent still requires review. Optional absent terms, including a month-to-month end date, are not invented.
- One initial Gemini request, at most one targeted Gemini reread and at most one `gpt-4o-mini` backup run within the same upload. Unknown document types may require an additional Gemini classification request. Rereads retain lossless selected PDF pages and cite their original page numbers. A subset cannot prove a term is absent across the whole document.
- Readable results stream into the upload review while recovery runs. A dropped stream or failed provider request retains partial fields. Uncertain and conflicting fields are displayed but excluded from mapped portfolio values. Rent-roll precedence and existing role separation remain in place.
- Per-attempt provider/model, phase, page scope and successful response token usage are saved in the document's `leaseReview` metadata. Confidence and reviewed-page reporting are model estimates, not guarantees of accuracy. Failed requests may have incurred usage even when no usage response was received.
- Word documents use extracted text and section references rather than invented physical page references. The existing 20 MB upload limit remains. Provider limits or an unreadable/password-protected document result in review or a clear failure; no PDF pages are silently truncated.

## Configuration

Configure `GEMINI_API_KEY` and `OPENAI_API_KEY` securely in Supabase Edge secrets. The Gemini key is required; if the OpenAI key is unavailable, unresolved lease details remain flagged. Cloud-development secrets alone do not configure deployed functions. Keys must not be added to browser `VITE_*` variables or committed files.

Large native files use Google's resumable Files API, validate the upload destination and delete temporary provider files after the request. Requests have timeouts and accept upload cancellation. Provider error bodies and keys are not returned to users.

## Verification

```bash
npm test -- --config scripts/vitest.lease-scan.config.ts
npm run build
```

The focused suite covers all-page input, late-page recovery, evidence validation, provider fallback, partial-result retention, streamed client updates and the guard that keeps `gpt-4o-mini` on the lease fallback only. Deno tests in `supabase/functions/_shared/onboarding/leaseDocumentSource_test.ts` generate a mixed 12-page PDF and verify unchanged native input and lossless selected-page rereads. Provider responses are mocked; live extraction accuracy has not been verified without credentials. The user removed the real-photo benchmark requirement.

## Release

Deploy from a clean committed tree using `scripts/deploy-edge-function.sh` (or its clean-tree/full-SHA checks with the verified CLI), following `.cursor/rules/edge-deploy-clean-tree.mdc`. Publish the frontend after the extraction endpoint supports the new stream protocol. No database migration is needed for lease-review metadata.

Removing the mini model from shared SMS and classification helpers also requires redeploying every Edge function that imports those helpers, including SMS, classification, vendor suggestions, insights and assistant endpoints. Use `collectImportGraph` from `scripts/edge-function-import-graph.mjs` to identify affected endpoints against the deployment's previous commit; deploying only `onboarding-document-extract` will not update those other functions. Existing Home Check migrations and deployment prerequisites remain documented in `HOME_CHECK.md`.

Deployment requires `SUPABASE_ACCESS_TOKEN`. Without that access, neither remote Edge secrets nor live activation can be verified. Existing OpenAI text helpers continue to require `OPENAI_API_KEY` and their model cost changes when moving to `gpt-4o`.
