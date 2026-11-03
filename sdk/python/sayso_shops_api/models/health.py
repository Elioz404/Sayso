from __future__ import annotations

from typing_extensions import NotRequired, TypedDict

from ..core import UNSET, Optional, SdkBaseModel
from .enums.storage import StorageOrStr


class Health(SdkBaseModel):
    ok: bool
    storage: Optional[StorageOrStr] = UNSET
    ai: Optional[str] = UNSET


class HealthDict(TypedDict):
    ok: bool
    storage: NotRequired[StorageOrStr]
    ai: NotRequired[str]
