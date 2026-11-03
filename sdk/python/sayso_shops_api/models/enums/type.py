from enum import Enum
from typing import Annotated, TypeAlias

from ...core import open_enum_validator


class Type(str, Enum):
    MISSING_FIELD = "MISSING_FIELD"
    INVALID_DATA = "INVALID_DATA"
    BUSINESS_RULE = "BUSINESS_RULE"

    __str__ = str.__str__


TypeOrStr: TypeAlias = Annotated[Type | str, open_enum_validator(Type)]
