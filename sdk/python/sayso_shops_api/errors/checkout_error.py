from __future__ import annotations

from dataclasses import dataclass
from typing import Final, TypeAlias

from ..core import ErrorMapper, RawError, decode_json
from ..models.cart import Cart
from ..models.error import Error

CheckoutErrorBody: TypeAlias = Error | Cart | RawError


@dataclass(frozen=True, slots=True)
class _CheckoutError:
    def map(self, status_code: int, content: bytes) -> CheckoutErrorBody:
        match status_code:
            case 404 | 502:
                return decode_json[Error](content)
            case 422:
                return decode_json[Cart](content)
            case _:
                return RawError(status_code, content)


checkout_error_mapper: Final[ErrorMapper[CheckoutErrorBody]] = _CheckoutError()
