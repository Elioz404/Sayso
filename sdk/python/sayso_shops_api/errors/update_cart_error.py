from __future__ import annotations

from dataclasses import dataclass
from typing import Final, TypeAlias

from ..core import ErrorMapper, RawError, decode_json
from ..models.error import Error

UpdateCartErrorBody: TypeAlias = Error | RawError


@dataclass(frozen=True, slots=True)
class _UpdateCartError:
    def map(self, status_code: int, content: bytes) -> UpdateCartErrorBody:
        match status_code:
            case 404 | 409 | 422 | 502:
                return decode_json[Error](content)
            case _:
                return RawError(status_code, content)


update_cart_error_mapper: Final[ErrorMapper[UpdateCartErrorBody]] = _UpdateCartError()
