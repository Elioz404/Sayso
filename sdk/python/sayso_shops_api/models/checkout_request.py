from __future__ import annotations

from typing_extensions import NotRequired, TypedDict

from ..core import UNSET, Optional, SdkBaseModel
from .cart_item import CartItem, CartItemDict
from .payment_method1 import PaymentMethod1, PaymentMethod1Dict


class CheckoutRequest(SdkBaseModel):
    items: Optional[list[CartItem]] = UNSET
    """Ignored; the stored cart is what gets paid."""

    payment_method: PaymentMethod1


class CheckoutRequestDict(TypedDict):
    items: NotRequired[list[CartItemDict]]
    payment_method: PaymentMethod1Dict
