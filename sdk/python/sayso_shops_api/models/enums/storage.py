from enum import Enum
from typing import Annotated, TypeAlias

from ...core import open_enum_validator


class Storage(str, Enum):
    MEMORY = "memory"
    POSTGRES = "postgres"

    __str__ = str.__str__


StorageOrStr: TypeAlias = Annotated[Storage | str, open_enum_validator(Storage)]
