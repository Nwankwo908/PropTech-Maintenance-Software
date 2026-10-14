# Equipment photo reading

Equipment photographs use **Gemini 3.8 Flash** (`gemini-3.8-flash`) first, with **`gpt-4o-mini`** for hard-to-read labels or a failed primary request. A confident, complete label does not call the backup. An absent label asks for a close-up rather than a second reading of the same distant view. Both providers use structured output. SMS maintenance triage keeps its own models.

## Edge configuration

Set `GEMINI_API_KEY` and `OPENAI_API_KEY` securely in Supabase Edge secrets. Never expose them through `VITE_` variables. Equipment defaults to Gemini. Optional settings:

```text
GEMINI_VISION_MODEL=gemini-3.8-flash
```

The Gemini adapter calls `generativelanguage.googleapis.com`; the backup calls `api.openai.com` with `gpt-4o-mini`. Apply both Home Check migrations before deploying the affected functions and frontend, as described in [HOME_CHECK.md](HOME_CHECK.md). These deployment steps and live provider calls have not been run in this environment.

## Capture and review

1. Ask for two photos per appliance: the whole appliance and a close-up of the data plate. Home Check reads only the pair scoped to that check and named system.
2. Unreadable labels return “Label unreadable, please send a closer photo without flash.” Low-confidence model and serial numbers stay unknown; a replacement label updates the same slot.
3. Ambiguous characters are marked in an unconfirmed reading, such as `AB[0/O]1234`, with their positions shown for human review. Conflicting readings from the providers also require review.
4. Check serial structure before accepting it. Basic character and length checks run by default. Optional `EQUIPMENT_SERIAL_FORMAT_RULES` is a JSON array of `{manufacturer, category?, pattern, description, source}`. Use documented rules scoped to the relevant manufacturer/system; the pattern is anchored automatically. No manufacturer format is invented or used to silently repair characters. Serial-derived age remains an estimate; unreadable serials leave it unknown.

Every asset retains field source and confidence plus the provider/model attempt trace. Four photos complete observation capture; readability and landlord confirmation remain separate outcomes. Retake flags block confirmation until clearer evidence arrives or the landlord checks the data plate and records a scoped correction. Corrections carry landlord provenance and an audit event. Leaving an unreadable identifier blank preserves it as unknown.

## Verification

```sh
npx vitest run --config scripts/vitest.equipment-vision.config.ts
npm run build
```

Fixture tests cover provider requests, paired images, fallback decisions, contradictory readings, uncertain characters, format checks, retakes, outage handling and stale replacements. The Home Check browser smoke uses mocked responses and includes landlord corrections and retakes. PostgreSQL contract tests exercise confirmation and audit rules. These tests do not establish extraction accuracy on real photographs or live provider availability.
