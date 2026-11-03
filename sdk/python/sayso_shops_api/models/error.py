from __future__ import annotations

from typing_extensions import NotRequired, TypedDict

from ..core import UNSET, Optional, SdkBaseModel


class Error(SdkBaseModel):
    name: str
    message: str
    debug_id: Optional[str] = UNSET
    """PayPal's debug id"""


class ErrorDict(TypedDict):
    name: str
    message: str
    debug_id: NotRequired[str]
