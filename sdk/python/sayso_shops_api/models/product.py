from __future__ import annotations

from typing_extensions import TypedDict

from ..core import SdkBaseModel
from .product_variant import ProductVariant, ProductVariantDict


class Product(SdkBaseModel):
    id: str
    name: str
    description: str
    category: str
    variants: list[ProductVariant]


class ProductDict(TypedDict):
    id: str
    name: str
    description: str
    category: str
    variants: list[ProductVariantDict]
