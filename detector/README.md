# tessera-detector

PII detection service for [Tessera](../README.md). Stateless, stable contract.

Layers: deterministic recognizers (Tier 1, catalog-driven), NER (GLiNER/ONNX),
context boosting. Spans always point into the original text. Checksum-backed
rules declare confidence 1.0. `EMAIL`, `DE_STEUERNUMMER` and `PHONE_NUMBER` do
not: an address is a pattern, a Steuernummer is structural, and a phone number
has no checksum.

`PHONE_NUMBER` matches an international number written with `+`. Validation
asks whether that number is valid for its country code, not merely a plausible
length. The surrounding text does not supply a country, so a national number
and a `00` prefix are left alone. An extension after the match is outside the
span. The check is local: no network call, and no claim that a subscriber exists.

```
uv sync
uv run pytest
```
