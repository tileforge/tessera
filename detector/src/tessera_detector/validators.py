"""Checksum validators for the identifier catalog (REQ-2).

Each validator answers one question: is this candidate a checksum-valid instance of
the identifier type? A failed checksum drops the candidate entirely — it never merely
lowers confidence. Validators must not raise on garbage input.
"""

import re
from collections.abc import Callable

import phonenumbers
import schwifty
import schwifty.exceptions
from stdnum import luhn
from stdnum.ch import ssn as _ch_ssn
from stdnum.de import idnr as _de_idnr
from stdnum.de import stnr as _de_stnr
from stdnum.fr import nif as _fr_nif
from stdnum.fr import nir as _fr_nir

_SEPARATORS = str.maketrans("", "", " .-")
# Same explicit labels as phonenumbers' parsing pattern: ext/extension,
# xt/xtension, доб, anexo. Exactly one space is required, so a glued letter
# is not an extension. A longer gap is not one either: phonenumbers rejects
# an input longer than 250 characters, and the trailing extension digits
# would then drop the base number. The catalog pattern repeats this suffix
# and must stay in step.
_EXPLICIT_EXTENSION = re.compile(
    r"(?i)[ ](?:ext(?:ension)?|xt(?:ension)?|доб|anexo)[.:]?[ ]?\d{1,20}\Z"
)


def _clean(value: str) -> str:
    return value.translate(_SEPARATORS)


def _credit_card(value: str) -> bool:
    digits = _clean(value)
    return 14 <= len(digits) <= 19 and digits.isdigit() and luhn.is_valid(digits)


def _split_explicit_extension(value: str) -> tuple[str, str]:
    suffix = _EXPLICIT_EXTENSION.search(value)
    if suffix is None:
        return value, ""
    extension = "".join(ch for ch in suffix.group(0) if ch.isdigit())
    return value[: suffix.start()], extension


def _phone_number(value: str) -> bool:
    # No checksum exists. `is_possible_number` is not enough: a reserved range
    # can be a plausible length and still not be a valid number.
    if any(ch in "\r\n" for ch in value):
        return False
    if value.startswith("+"):
        return _international_phone(value)
    # Trunk 0 is the German national form. The region is the constant below,
    # not a guess from the surrounding text. A 00 prefix is not that form.
    if value.startswith("0") or value.startswith("(0"):
        return _german_national_phone(value)
    return False


def _international_phone(value: str) -> bool:
    base, extension = _split_explicit_extension(value)
    if any(ch.isalpha() for ch in base):
        return False
    digit_count = 0
    separators = 0
    for ch in base[1:]:
        if ch.isdigit():
            digit_count += 1
        elif ch in " .-()":
            separators += 1
        else:
            return False
    # E.164 holds at most 15 digits. Extra digits must fail the whole candidate:
    # phonenumbers will not be asked to accept a shorter slice of it. Digits
    # of a labeled extension are not part of that count.
    if not 1 <= digit_count <= 15 or separators > 16:
        return False
    try:
        parsed = phonenumbers.parse(value, None)
    except phonenumbers.NumberParseException:
        return False
    if (parsed.extension or "") != extension:
        return False
    # `parse` drops one trunk `0` written after the country code (`+44 (0)20…`).
    # The base is accepted when its digits are the E.164 digits, or those
    # digits with that single trunk zero. Any other extra digit rejects it.
    e164 = phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
    digits = "".join(ch for ch in base if ch.isdigit())
    e164_digits = e164[1:]
    country = str(parsed.country_code)
    trunk = ""
    if e164_digits.startswith(country):
        trunk = country + "0" + e164_digits[len(country) :]
    if digits != e164_digits and digits != trunk:
        return False
    return phonenumbers.is_valid_number(parsed)


def _german_national_phone(value: str) -> bool:
    if value.startswith("00") or value.startswith("(00"):
        return False
    base, extension = _split_explicit_extension(value)
    if any(ch.isalpha() for ch in base):
        return False
    digit_count = 0
    separators = 0
    for ch in base:
        if ch.isdigit():
            digit_count += 1
        elif ch in " .-()/":
            separators += 1
        else:
            return False
    # Trunk 0 plus an NSN of 4 to 15 digits. Extra digits fail the candidate
    # rather than a shorter slice of it.
    if not 5 <= digit_count <= 16 or separators > 16:
        return False
    try:
        parsed = phonenumbers.parse(value, "DE")
    except phonenumbers.NumberParseException:
        return False
    if (parsed.extension or "") != extension or parsed.country_code != 49:
        return False
    if phonenumbers.region_code_for_number(parsed) != "DE":
        return False
    digits = "".join(ch for ch in base if ch.isdigit())
    if digits != "0" + str(parsed.national_number):
        return False
    return phonenumbers.is_valid_number(parsed)


def _iban(value: str) -> bool:
    # schwifty checks country, length, BBAN structure and the mod-97 checksum but not
    # bank-registry membership: a real IBAN of a bank missing from a registry snapshot
    # must still be detected (recall over registry freshness). Case-insensitive.
    try:
        schwifty.IBAN(_clean(value))
    except schwifty.exceptions.SchwiftyException:
        return False
    return True


VALIDATORS: dict[str, Callable[[str], bool]] = {
    "iban": _iban,
    "credit_card": _credit_card,
    "ch_avs": lambda v: _ch_ssn.is_valid(_clean(v)),
    "fr_nir": lambda v: _fr_nir.is_valid(_clean(v)),
    "fr_nif": lambda v: _fr_nif.is_valid(_clean(v)),
    "de_idnr": lambda v: _de_idnr.is_valid(_clean(v)),
    # Structural validation only — the Steuernummer has no checksum; the catalog
    # compensates with a low base confidence gated by context triggers.
    "de_stnr": lambda v: _de_stnr.is_valid(v),
    # Structural validation only — a phone number has no checksum.
    "phone_number": _phone_number,
}


# Validators that verify a checksum (not merely structure). Rules backed by these
# must keep confidence 1.0 — the untouchable invariant is not configurable away.
# de_stnr and phone_number are structural only and are deliberately excluded.
# The set is every validator except these names, so a new structural validator
# joins the checksum set unless this line changes with it.
CHECKSUM_VALIDATORS: frozenset[str] = frozenset(VALIDATORS) - {"de_stnr", "phone_number"}
