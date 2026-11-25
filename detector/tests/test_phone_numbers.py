"""International phone numbers: catalog candidate, phonenumbers verdict, original offsets.

Reserved examples only — NANPA 555-0100..0199 and Ofcom 020 7946 0xxx.
The 07700 900xxx drama range is only "possible" in phonenumbers, not valid.
National numbers, a 00 prefix and extension suffixes are outside this version.
"""

import time

import pytest

from tessera_detector.deterministic import DeterministicDetector
from tessera_detector.pipeline import DEFAULT_MODEL_ID, Detector
from tessera_detector.spans import Span

US = "+1 202-555-0100"
UK = "+44 20 7946 0958"


def _detector() -> Detector:
    return Detector(model_id=DEFAULT_MODEL_ID)


def _phones(text: str) -> list[Span]:
    return [span for span in _detector().detect(text) if span.entity_type == "PHONE_NUMBER"]


def _assert_phone(text: str, number: str) -> Span:
    matches = [span for span in _phones(text) if text[span.start : span.end] == number]
    assert matches, f"no PHONE_NUMBER span for {number!r} in {text!r}; got {_phones(text)}"
    (span,) = matches
    assert span.recognizer == "catalog:phone_number"
    assert span.tier == 1
    assert span.confidence == 0.9
    assert span.boosted is False
    return span


@pytest.mark.parametrize(
    "number",
    [
        "+12025550100",
        "+1 202-555-0100",
        "+1 202 555 0100",
        "+1 (202) 555-0100",
        "+1.202.555.0100",
        "+442079460958",
        "+44 20 7946 0958",
        "+44-20-7946-0958",
        "+44.20.7946.0958",
        "+44 (20) 7946 0958",
        "+4402079460958",
        "+44 020 7946 0958",
        "+44 (0) 20 7946 0958",
        "+44 (0)20 7946 0958",
        "+1(202)555-0100",
        "+1 (202)555-0100",
        "+1(202)(555)0100",
    ],
)
def test_reserved_numbers_keep_their_written_form(number: str) -> None:
    text = f"Reach {number} today."
    span = _assert_phone(text, number)
    assert text[span.start : span.end] == number


def test_two_numbers_in_one_sentence_stay_separate() -> None:
    text = f"US {US} and UK {UK}."
    assert [text[span.start : span.end] for span in _phones(text)] == [US, UK]
    assert all(span.boosted is False and span.confidence == 0.9 for span in _phones(text))


def test_a_number_at_the_end_of_the_line_is_closed() -> None:
    text = f"Call {US}"
    span = _assert_phone(text, US)
    assert span.end == len(text)


@pytest.mark.parametrize(
    "text",
    [
        "Call 202-555-0100 today.",
        "Call 020 7946 0958 today.",
        "Call 0012025550100 today.",
        "Call 00 1 202 555 0100 today.",
        "Call +999 123 456 7890 today.",
        "Call +1 555 today.",
        "Call +1234567890123456 today.",
        "Meeting on 2026-11-25.",
        "Order 12345678901234 is packed.",
        "ref 99+12025550100",
        "ref 99 +1 202-555-0100",
        "Call +1 202-555-0100 99 today.",
        "Call +1202555010099 today.",
        "Call +12025550100(99) today.",
        "Call +1 202-555-0100/123 today.",
        "Call +44020794609581 today.",
        "Call +44 00 20 7946 0958 today.",
        "Call +1 202-555-0100abc today.",
        "Call +1 202\n555-0100 today.",
    ],
)
def test_non_international_and_overlong_runs_are_not_phones(text: str) -> None:
    assert _phones(text) == []


def test_an_extension_leaves_the_suffix_outside_the_span() -> None:
    # First version masks the international number and may leave the extension.
    text = "Call +1 202-555-0100 ext. 123 now."
    span = _assert_phone(text, US)
    assert text[span.end :].startswith(" ext. 123")


def test_cyrillic_and_an_emoji_do_not_move_the_span() -> None:
    text = f"Позвоните 📞 {UK} завтра"
    span = _assert_phone(text, UK)
    assert text[span.start : span.end] == UK


def test_nbsp_separators_map_back_to_the_original_characters() -> None:
    number = "+1\u00a0202\u00a0555-0100"
    text = f"Tel {number}."
    span = _assert_phone(text, number)
    assert text[span.start : span.end] == number


def test_unicode_hyphens_map_back_to_the_original_characters() -> None:
    number = "+1 202\u2011555\u20110100"
    text = f"Tel {number}."
    span = _assert_phone(text, number)
    assert text[span.start : span.end] == number


def test_fullwidth_digits_map_back_to_the_original_characters() -> None:
    number = "\uff0b\uff11 \uff12\uff10\uff12-\uff15\uff15\uff15-\uff10\uff11\uff10\uff10"
    text = f"Tel {number}."
    span = _assert_phone(text, number)
    assert text[span.start : span.end] == number


def test_a_long_false_candidate_is_not_a_phone() -> None:
    assert _phones("+" + "-1234" * 80) == []
    assert _phones("+" + "1" * 200) == []


def test_a_parenthesized_digit_run_is_not_repartitioned() -> None:
    # Optional separators after ')' used to split one digit run into every
    # composition of up to five chunks. This is that input: no phone, and the
    # scan has to finish well under the multi-second partition.
    text = ("+1(202)" + "1" * 60 + "a ") * 100
    started = time.perf_counter()
    spans = DeterministicDetector().detect(text)
    elapsed = time.perf_counter() - started
    assert [span for span in spans if span.entity_type == "PHONE_NUMBER"] == []
    assert elapsed < 1


def test_both_pipeline_branches_report_the_same_phone() -> None:
    text = f"Call {US} today."
    detector = _detector()
    deterministic = detector.deterministic_only(text)
    resolved = detector.detect(text)
    assert [(s.entity_type, s.start, s.end) for s in deterministic] == [
        (s.entity_type, s.start, s.end) for s in resolved
    ]
    assert any(span.entity_type == "PHONE_NUMBER" for span in deterministic)


def test_a_custom_catalog_without_the_rule_does_not_invent_phones() -> None:
    catalog = """
version: 1
identifiers:
  - id: naked
    entity_type: NAKED
    tier: 2
    confidence: 0.5
    pattern: 'x+'
"""
    spans = DeterministicDetector(catalog).detect(f"Call {US} today.")
    assert [span.entity_type for span in spans] == []


def test_a_checksum_span_keeps_its_identity_when_a_phone_overlaps_it() -> None:
    from tessera_detector.resolution import resolve

    iban = Span(
        entity_type="IBAN",
        start=0,
        end=22,
        confidence=1.0,
        recognizer="catalog:iban",
        tier=1,
    )
    phone = Span(
        entity_type="PHONE_NUMBER",
        start=18,
        end=40,
        confidence=0.9,
        recognizer="catalog:phone_number",
        tier=1,
    )
    (kept,) = resolve(
        [phone, iban],
        specificity={"IBAN": 90, "PHONE_NUMBER": 35},
    ).spans
    assert kept.entity_type == "IBAN"
    assert kept.recognizer == "catalog:iban"
    assert (kept.start, kept.end) == (0, 40)
