from __future__ import annotations

from ..core import (
    ApiResult,
    AsyncRawClient,
    BaseRawResponse,
    RawClient,
    RequestOptionsOrDict,
    async_json_decoder,
    json_decoder,
    param,
    unwrap,
)
from ..errors.list_shops_error import ListShopsErrorBody, list_shops_error_mapper
from ..errors.search_products_error import SearchProductsErrorBody, search_products_error_mapper
from ..models.shop_offer import ShopOffer
from ..models.shop_summary import ShopSummary
from ..server.server import Server


class Shops:
    def __init__(self, client: RawClient, server: Server) -> None:
        self._with_raw_response = ShopsWithRawResponse(client, server)

    def list_shops(self, *, request_options: RequestOptionsOrDict | None = None) -> list[ShopSummary]:
        """Every published shop, with what it sells and where it ships from.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Published shops

        Raises:
            ApiError: Unexpected server error ``error`` is ``Error | RawError``."""
        return unwrap(self._with_raw_response.list_shops(request_options=request_options))

    def search_products(
        self,
        slug: str,
        *,
        query: str | None = None,
        max_price: str | None = None,
        in_stock_only: bool | None = False,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ShopOffer:
        """Products whose name, description, category or tags contain every word of ``query``.

        Args:
            slug: The shop, e.g. maya-ceramics
            query: Words to match, e.g. "green mug". Leave out to list everything.
            max_price: Highest price per item in the shop's currency, e.g. "40.00".
            in_stock_only: Leave out sold-out variants (made-to-order ones always stay).
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            What the shop offers for this search

        Raises:
            ApiError: The request is malformed No such published shop, or no such cart at this shop ``error`` is ``Error
                | RawError``."""
        return unwrap(
            self._with_raw_response.search_products(
                slug, query=query, max_price=max_price, in_stock_only=in_stock_only, request_options=request_options
            ),
        )

    @property
    def with_raw_response(self) -> ShopsWithRawResponse:
        return self._with_raw_response


class AsyncShops:
    def __init__(self, client: AsyncRawClient, server: Server) -> None:
        self._with_raw_response = AsyncShopsWithRawResponse(client, server)

    async def list_shops(self, *, request_options: RequestOptionsOrDict | None = None) -> list[ShopSummary]:
        """Every published shop, with what it sells and where it ships from.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            Published shops

        Raises:
            ApiError: Unexpected server error ``error`` is ``Error | RawError``."""
        return unwrap(await self._with_raw_response.list_shops(request_options=request_options))

    async def search_products(
        self,
        slug: str,
        *,
        query: str | None = None,
        max_price: str | None = None,
        in_stock_only: bool | None = False,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ShopOffer:
        """Products whose name, description, category or tags contain every word of ``query``.

        Args:
            slug: The shop, e.g. maya-ceramics
            query: Words to match, e.g. "green mug". Leave out to list everything.
            max_price: Highest price per item in the shop's currency, e.g. "40.00".
            in_stock_only: Leave out sold-out variants (made-to-order ones always stay).
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            What the shop offers for this search

        Raises:
            ApiError: The request is malformed No such published shop, or no such cart at this shop ``error`` is ``Error
                | RawError``."""
        return unwrap(
            await self._with_raw_response.search_products(
                slug, query=query, max_price=max_price, in_stock_only=in_stock_only, request_options=request_options
            ),
        )

    @property
    def with_raw_response(self) -> AsyncShopsWithRawResponse:
        return self._with_raw_response


class ShopsWithRawResponse(BaseRawResponse[RawClient, Server]):
    def list_shops(
        self, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[list[ShopSummary], ListShopsErrorBody]:
        """Every published shop, with what it sells and where it ships from.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="GET",
            url_template=self._server.default("/api/shops"),
            decoder=json_decoder[list[ShopSummary]],
            error_mapper=list_shops_error_mapper,
            request_options=request_options,
        )

    def search_products(
        self,
        slug: str,
        *,
        query: str | None = None,
        max_price: str | None = None,
        in_stock_only: bool | None = False,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiResult[ShopOffer, SearchProductsErrorBody]:
        """Products whose name, description, category or tags contain every word of ``query``.

        Args:
            slug: The shop, e.g. maya-ceramics
            query: Words to match, e.g. "green mug". Leave out to list everything.
            max_price: Highest price per item in the shop's currency, e.g. "40.00".
            in_stock_only: Leave out sold-out variants (made-to-order ones always stay).
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="GET",
            url_template=self._server.default("/api/shops/{slug}/products"),
            path_params=[param[str]("slug", slug)],
            query_params=[
                param[str | None]("query", query),
                param[str | None]("max_price", max_price),
                param[bool | None]("in_stock_only", in_stock_only),
            ],
            decoder=json_decoder[ShopOffer],
            error_mapper=search_products_error_mapper,
            request_options=request_options,
        )


class AsyncShopsWithRawResponse(BaseRawResponse[AsyncRawClient, Server]):
    async def list_shops(
        self, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[list[ShopSummary], ListShopsErrorBody]:
        """Every published shop, with what it sells and where it ships from.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="GET",
            url_template=self._server.default("/api/shops"),
            decoder=async_json_decoder[list[ShopSummary]],
            error_mapper=list_shops_error_mapper,
            request_options=request_options,
        )

    async def search_products(
        self,
        slug: str,
        *,
        query: str | None = None,
        max_price: str | None = None,
        in_stock_only: bool | None = False,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiResult[ShopOffer, SearchProductsErrorBody]:
        """Products whose name, description, category or tags contain every word of ``query``.

        Args:
            slug: The shop, e.g. maya-ceramics
            query: Words to match, e.g. "green mug". Leave out to list everything.
            max_price: Highest price per item in the shop's currency, e.g. "40.00".
            in_stock_only: Leave out sold-out variants (made-to-order ones always stay).
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="GET",
            url_template=self._server.default("/api/shops/{slug}/products"),
            path_params=[param[str]("slug", slug)],
            query_params=[
                param[str | None]("query", query),
                param[str | None]("max_price", max_price),
                param[bool | None]("in_stock_only", in_stock_only),
            ],
            decoder=async_json_decoder[ShopOffer],
            error_mapper=search_products_error_mapper,
            request_options=request_options,
        )
