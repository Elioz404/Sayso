from __future__ import annotations

from typing import Literal

from pydantic import Field
from typing_extensions import NotRequired, TypedDict

from ..core import UNSET, Optional, SdkBaseModel


class PaymentMethod1(SdkBaseModel):
    type_: Literal["paypal"] = Field(default="paypal", alias="type")
    token: str
    """The PayPal order id the buyer approved"""

    payer_id: Optional[str] = UNSET
    """PayerID from PayPal's return URL"""


class PaymentMethod1Dict(TypedDict):
    type_: Literal["paypal"]
    token: str
    payer_id: NotRequired[str]
