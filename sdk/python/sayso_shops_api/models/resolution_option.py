from __future__ import annotations

from typing_extensions import NotRequired, TypedDict

from ..core import UNSET, Optional, SdkBaseModel
from .metadata import Metadata, MetadataDict


class ResolutionOption(SdkBaseModel):
    action: str
    label: str
    metadata: Optional[Metadata] = UNSET


class ResolutionOptionDict(TypedDict):
    action: str
    label: str
    metadata: NotRequired[MetadataDict]
