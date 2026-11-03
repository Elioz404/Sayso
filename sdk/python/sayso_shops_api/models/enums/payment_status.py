from enum import Enum
from typing import Annotated, TypeAlias

from ...core import open_enum_validator


class PaymentStatus(str, Enum):
    """CAPTURED means charged; otherwise authorized and waiting for the shop owner."""

    CAPTURED = "CAPTURED"
    AUTHORIZED_PENDING_MERCHANT_REVIEW = "AUTHORIZED_PENDING_MERCHANT_REVIEW"

    __str__ = str.__str__


PaymentStatusOrStr: TypeAlias = Annotated[PaymentStatus | str, open_enum_validator(PaymentStatus)]
