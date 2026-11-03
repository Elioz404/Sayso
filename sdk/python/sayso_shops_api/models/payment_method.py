from __future__ import annotations

from typing import Literal

from pydantic import Field
from typing_extensions import NotRequired, TypedDict

from ..core import UNSET, Optional, SdkBaseModel


class PaymentMethod(SdkBaseModel):
    type_: Literal["paypal"] = Field(default="paypal", alias="type")
    token: Optional[str] = UNSET
    """The PayPal order id"""

    payer_id: Optional[str] = UNSET
    approval_url: Optional[str] = UNSET
    """Where the buyer approves the payment in PayPal"""


class PaymentMethodDict(TypedDict):
    type_: Literal["paypal"]
    token: NotRequired[str]
    payer_id: NotRequired[str]
    approval_url: NotRequired[str]
