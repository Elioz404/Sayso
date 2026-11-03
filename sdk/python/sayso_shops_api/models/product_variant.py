from __future__ import annotations

from typing_extensions import TypedDict

from ..core import SdkBaseModel
from .unions.in_stock import InStock, InStockDict


class ProductVariant(SdkBaseModel):
    variant_id: str
    title: str
    price: str
    """Formatted price"""

    in_stock: InStock
    """Units on hand, or a made-to-order lead time"""


class ProductVariantDict(TypedDict):
    variant_id: str
    title: str
    price: str
    in_stock: InStockDict
