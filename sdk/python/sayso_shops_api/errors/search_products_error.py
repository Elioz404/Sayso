from __future__ import annotations

from dataclasses import dataclass
from typing import Final, TypeAlias

from ..core import ErrorMapper, RawError, decode_json
from ..models.error import Error

SearchProductsErrorBody: TypeAlias = Error | RawError


@dataclass(frozen=True, slots=True)
class _SearchProductsError:
    def map(self, status_code: int, content: bytes) -> SearchProductsErrorBody:
        match status_code:
            case 400 | 404:
                return decode_json[Error](content)
            case _:
                return RawError(status_code, content)


search_products_error_mapper: Final[ErrorMapper[SearchProductsErrorBody]] = _SearchProductsError()
