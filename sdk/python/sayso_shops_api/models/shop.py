from __future__ import annotations

from typing_extensions import TypedDict

from ..core import SdkBaseModel
from .enums.status1 import Status1OrStr


class Shop(SdkBaseModel):
    slug: str
    name: str
    currency: str
    ships_from: str
    status: Status1OrStr


class ShopDict(TypedDict):
    slug: str
    name: str
    currency: str
    ships_from: str
    status: Status1OrStr
