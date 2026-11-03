from __future__ import annotations

from typing_extensions import NotRequired, TypedDict

from ..core import UNSET, Optional, SdkBaseModel


class ErrorError(SdkBaseModel):
    name: str
    message: str
    debug_id: Optional[str] = UNSET
    """PayPal's debug id"""


class ErrorErrorDict(TypedDict):
    name: str
    message: str
    debug_id: NotRequired[str]
