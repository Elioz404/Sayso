from enum import Enum
from typing import Annotated, TypeAlias

from ...core import open_enum_validator


class ValidationStatus(str, Enum):
    VALID = "VALID"
    INVALID = "INVALID"
    REQUIRES_ADDITIONAL_INFORMATION = "REQUIRES_ADDITIONAL_INFORMATION"

    __str__ = str.__str__


ValidationStatusOrStr: TypeAlias = Annotated[ValidationStatus | str, open_enum_validator(ValidationStatus)]
