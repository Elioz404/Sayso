from __future__ import annotations

from typing import Any

from pydantic import Field
from typing_extensions import NotRequired, TypedDict

from ..core import UNSET, Optional, SdkBaseModel
from .enums.code import CodeOrStr
from .enums.type import TypeOrStr
from .resolution_option import ResolutionOption, ResolutionOptionDict


class ValidationIssue(SdkBaseModel):
    code: CodeOrStr
    type_: TypeOrStr = Field(alias="type")
    message: str
    user_message: Optional[str] = UNSET
    variant_id: Optional[str] = UNSET
    field: Optional[str] = UNSET
    context: Optional[Any] = UNSET
    resolution_options: Optional[list[ResolutionOption]] = UNSET


class ValidationIssueDict(TypedDict):
    code: CodeOrStr
    type_: TypeOrStr
    message: str
    user_message: NotRequired[str]
    variant_id: NotRequired[str]
    field: NotRequired[str]
    context: NotRequired[Any]
    resolution_options: NotRequired[list[ResolutionOptionDict]]
