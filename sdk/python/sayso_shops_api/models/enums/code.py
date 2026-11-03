from enum import Enum
from typing import Annotated, TypeAlias

from ...core import open_enum_validator


class Code(str, Enum):
    INVENTORY_ISSUE = "INVENTORY_ISSUE"
    PRICING_ERROR = "PRICING_ERROR"
    SHIPPING_ERROR = "SHIPPING_ERROR"
    PAYMENT_ERROR = "PAYMENT_ERROR"
    DATA_ERROR = "DATA_ERROR"
    BUSINESS_RULE_ERROR = "BUSINESS_RULE_ERROR"

    __str__ = str.__str__


CodeOrStr: TypeAlias = Annotated[Code | str, open_enum_validator(Code)]
