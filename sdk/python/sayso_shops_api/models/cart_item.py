from __future__ import annotations

from typing_extensions import NotRequired, TypedDict

from ..core import UNSET, Optional, SdkBaseModel
from .money import Money, MoneyDict
from .selected_attribute import SelectedAttribute, SelectedAttributeDict


class CartItem(SdkBaseModel):
    variant_id: Optional[str] = UNSET
    quantity: int
    parent_id: Optional[str] = UNSET
    name: Optional[str] = UNSET
    description: Optional[str] = UNSET
    price: Optional[Money] = UNSET
    """An amount as PayPal writes it."""

    selected_attributes: Optional[list[SelectedAttribute]] = UNSET


class CartItemDict(TypedDict):
    variant_id: NotRequired[str]
    quantity: int
    parent_id: NotRequired[str]
    name: NotRequired[str]
    description: NotRequired[str]
    price: NotRequired[MoneyDict]
    selected_attributes: NotRequired[list[SelectedAttributeDict]]
