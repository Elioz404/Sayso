from __future__ import annotations

from typing_extensions import NotRequired, TypedDict

from ..core import UNSET, Optional, SdkBaseModel
from .address import Address, AddressDict
from .cart_item import CartItem, CartItemDict
from .cart_totals import CartTotals, CartTotalsDict
from .customer import Customer, CustomerDict
from .enums.status import StatusOrStr
from .enums.validation_status import ValidationStatusOrStr
from .payment_method import PaymentMethod, PaymentMethodDict
from .shipping_option import ShippingOption, ShippingOptionDict
from .validation_issue import ValidationIssue, ValidationIssueDict


class CartError(SdkBaseModel):
    id: Optional[str] = UNSET
    status: Optional[StatusOrStr] = UNSET
    validation_status: Optional[ValidationStatusOrStr] = UNSET
    validation_issues: Optional[list[ValidationIssue]] = UNSET
    items: list[CartItem]
    totals: Optional[CartTotals] = UNSET
    available_shipping_options: Optional[list[ShippingOption]] = UNSET
    customer: Optional[Customer] = UNSET
    shipping_address: Optional[Address] = UNSET
    billing_address: Optional[Address] = UNSET
    payment_method: Optional[PaymentMethod] = UNSET


class CartErrorDict(TypedDict):
    id: NotRequired[str]
    status: NotRequired[StatusOrStr]
    validation_status: NotRequired[ValidationStatusOrStr]
    validation_issues: NotRequired[list[ValidationIssueDict]]
    items: list[CartItemDict]
    totals: NotRequired[CartTotalsDict]
    available_shipping_options: NotRequired[list[ShippingOptionDict]]
    customer: NotRequired[CustomerDict]
    shipping_address: NotRequired[AddressDict]
    billing_address: NotRequired[AddressDict]
    payment_method: NotRequired[PaymentMethodDict]
