from __future__ import annotations

from typing_extensions import NotRequired, TypedDict

from ..core import UNSET, Optional, SdkBaseModel


class Address(SdkBaseModel):
    address_line_1: Optional[str] = UNSET
    address_line_2: Optional[str] = UNSET
    admin_area_2: Optional[str] = UNSET
    """City"""

    admin_area_1: Optional[str] = UNSET
    """State or province code"""

    postal_code: Optional[str] = UNSET
    country_code: str
    """ISO-3166 alpha-2"""


class AddressDict(TypedDict):
    address_line_1: NotRequired[str]
    address_line_2: NotRequired[str]
    admin_area_2: NotRequired[str]
    admin_area_1: NotRequired[str]
    postal_code: NotRequired[str]
    country_code: str
