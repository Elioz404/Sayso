from enum import Enum
from typing import Annotated, TypeAlias

from ...core import open_enum_validator


class Status(str, Enum):
    CREATED = "CREATED"
    INCOMPLETE = "INCOMPLETE"
    READY = "READY"
    COMPLETED = "COMPLETED"

    __str__ = str.__str__


StatusOrStr: TypeAlias = Annotated[Status | str, open_enum_validator(Status)]
