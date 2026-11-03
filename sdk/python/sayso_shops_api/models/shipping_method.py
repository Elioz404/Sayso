from __future__ import annotations

from typing_extensions import TypedDict

from ..core import SdkBaseModel


class ShippingMethod(SdkBaseModel):
    name: str
    to: str
    """Comma-separated country codes"""

    price: str
    days: str


class ShippingMethodDict(TypedDict):
    name: str
    to: str
    price: str
    days: str
