from __future__ import annotations

from typing_extensions import NotRequired, TypedDict

from ..core import UNSET, Optional, SdkBaseModel
from .enums.payment_status import PaymentStatusOrStr


class PaymentConfirmation(SdkBaseModel):
    merchant_order_number: str
    paypal_order_id: Optional[str] = UNSET
    payment_status: PaymentStatusOrStr
    """CAPTURED means charged; otherwise authorized and waiting for the shop owner."""

    guard_record_id: Optional[str] = UNSET
    """The shop's say-so record for the capture"""


class PaymentConfirmationDict(TypedDict):
    merchant_order_number: str
    paypal_order_id: NotRequired[str]
    payment_status: PaymentStatusOrStr
    guard_record_id: NotRequired[str]
