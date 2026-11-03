from __future__ import annotations

from typing_extensions import TypedDict

from ..core import SdkBaseModel


class ShopSummary(SdkBaseModel):
    shop: str
    """The slug to use in other calls"""

    name: str
    ships_from: str
    currency: str
    sells: list[str]
    products: int
    """How many products it has"""


class ShopSummaryDict(TypedDict):
    shop: str
    name: str
    ships_from: str
    currency: str
    sells: list[str]
    products: int
