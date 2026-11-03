from __future__ import annotations

from typing_extensions import TypedDict

from ..core import SdkBaseModel


class Money(SdkBaseModel):
    """An amount as PayPal writes it."""

    currency_code: str
    value: str


class MoneyDict(TypedDict):
    currency_code: str
    value: str
