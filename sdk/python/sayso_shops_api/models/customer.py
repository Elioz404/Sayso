from __future__ import annotations

from typing_extensions import NotRequired, TypedDict

from ..core import UNSET, Optional, SdkBaseModel
from .name import Name, NameDict


class Customer(SdkBaseModel):
    email_address: Optional[str] = UNSET
    phone: Optional[str] = UNSET
    name: Optional[Name] = UNSET


class CustomerDict(TypedDict):
    email_address: NotRequired[str]
    phone: NotRequired[str]
    name: NotRequired[NameDict]
