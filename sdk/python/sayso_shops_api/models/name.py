from __future__ import annotations

from typing_extensions import NotRequired, TypedDict

from ..core import UNSET, Optional, SdkBaseModel


class Name(SdkBaseModel):
    given_name: Optional[str] = UNSET
    surname: Optional[str] = UNSET


class NameDict(TypedDict):
    given_name: NotRequired[str]
    surname: NotRequired[str]
