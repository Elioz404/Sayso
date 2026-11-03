from __future__ import annotations

from typing_extensions import NotRequired, TypedDict

from ..core import UNSET, Optional, SdkBaseModel
from .money import Money, MoneyDict


class Metadata(SdkBaseModel):
    priority: Optional[int] = UNSET
    auto_applicable: Optional[bool] = UNSET
    cost_impact: Optional[Money] = UNSET
    """An amount as PayPal writes it."""


class MetadataDict(TypedDict):
    priority: NotRequired[int]
    auto_applicable: NotRequired[bool]
    cost_impact: NotRequired[MoneyDict]
