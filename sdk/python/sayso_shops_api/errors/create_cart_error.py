from __future__ import annotations

from dataclasses import dataclass
from typing import Final, TypeAlias

from ..core import ErrorMapper, RawError, decode_json
from ..models.error import Error

CreateCartErrorBody: TypeAlias = Error | RawError


@dataclass(frozen=True, slots=True)
class _CreateCartError:
    def map(self, status_code: int, content: bytes) -> CreateCartErrorBody:
        match status_code:
            case 400 | 404 | 502:
                return decode_json[Error](content)
            case _:
                return RawError(status_code, content)


create_cart_error_mapper: Final[ErrorMapper[CreateCartErrorBody]] = _CreateCartError()
