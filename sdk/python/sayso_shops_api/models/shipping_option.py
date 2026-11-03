from __future__ import annotations

from typing_extensions import NotRequired, TypedDict

from ..core import UNSET, Date, Optional, SdkBaseModel
from .money import Money, MoneyDict


class ShippingOption(SdkBaseModel):
    id: str
    name: str
    price: Money
    """An amount as PayPal writes it."""

    is_selected: bool
    description: Optional[str] = UNSET
    estimated_delivery: Optional[Date] = UNSET


class ShippingOptionDict(TypedDict):
    id: str
    name: str
    price: MoneyDict
    is_selected: bool
    description: NotRequired[str]
    estimated_delivery: NotRequired[Date]
