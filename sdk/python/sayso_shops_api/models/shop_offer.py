from __future__ import annotations

from typing_extensions import TypedDict

from ..core import SdkBaseModel
from .product import Product, ProductDict
from .shipping_method import ShippingMethod, ShippingMethodDict
from .shop import Shop, ShopDict


class ShopOffer(SdkBaseModel):
    shop: Shop
    products: list[Product]
    shipping: list[ShippingMethod]
    returns: str


class ShopOfferDict(TypedDict):
    shop: ShopDict
    products: list[ProductDict]
    shipping: list[ShippingMethodDict]
    returns: str
