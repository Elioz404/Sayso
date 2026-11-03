from __future__ import annotations

from typing_extensions import NotRequired, TypedDict

from ..core import UNSET, Optional, SdkBaseModel
from .address import Address, AddressDict
from .cart_item import CartItem, CartItemDict
from .customer import Customer, CustomerDict
from .shipping_option import ShippingOption, ShippingOptionDict


class CartRequest(SdkBaseModel):
    items: list[CartItem]
    shipping_address: Optional[Address] = UNSET
    billing_address: Optional[Address] = UNSET
    customer: Optional[Customer] = UNSET
    available_shipping_options: Optional[list[ShippingOption]] = UNSET
    """Mark one ``is_selected`` to pick it; the rest is ignored."""


class CartRequestDict(TypedDict):
    items: list[CartItemDict]
    shipping_address: NotRequired[AddressDict]
    billing_address: NotRequired[AddressDict]
    customer: NotRequired[CustomerDict]
    available_shipping_options: NotRequired[list[ShippingOptionDict]]
