from __future__ import annotations

from dataclasses import dataclass
from typing import Final, TypeAlias

from ..core import ErrorMapper, RawError, decode_json
from ..models.error import Error

ListShopsErrorBody: TypeAlias = Error | RawError


@dataclass(frozen=True, slots=True)
class _ListShopsError:
    def map(self, status_code: int, content: bytes) -> ListShopsErrorBody:
        match status_code:
            case 500:
                return decode_json[Error](content)
            case _:
                return RawError(status_code, content)


list_shops_error_mapper: Final[ErrorMapper[ListShopsErrorBody]] = _ListShopsError()
