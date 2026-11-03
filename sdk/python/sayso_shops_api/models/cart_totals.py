from __future__ import annotations

from typing_extensions import NotRequired, TypedDict

from ..core import UNSET, Optional, SdkBaseModel
from .money import Money, MoneyDict


class CartTotals(SdkBaseModel):
    subtotal: Optional[Money] = UNSET
    """An amount as PayPal writes it."""

    shipping: Optional[Money] = UNSET
    """An amount as PayPal writes it."""

    tax: Optional[Money] = UNSET
    """An amount as PayPal writes it."""

    discount: Optional[Money] = UNSET
    """An amount as PayPal writes it."""

    total: Money
    """An amount as PayPal writes it."""


class CartTotalsDict(TypedDict):
    subtotal: NotRequired[MoneyDict]
    shipping: NotRequired[MoneyDict]
    tax: NotRequired[MoneyDict]
    discount: NotRequired[MoneyDict]
    total: MoneyDict
