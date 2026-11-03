from __future__ import annotations

from ..core import (
    ApiResult,
    AsyncRawClient,
    BaseRawResponse,
    RawClient,
    RequestOptionsOrDict,
    async_json_decoder,
    json_decoder,
    unwrap,
)
from ..errors.health_error import HealthErrorBody, health_error_mapper
from ..models.health import Health
from ..server.server import Server


class Service:
    def __init__(self, client: RawClient, server: Server) -> None:
        self._with_raw_response = ServiceWithRawResponse(client, server)

    def health(self, *, request_options: RequestOptionsOrDict | None = None) -> Health:
        """Send a ``GET`` request.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            The server and its storage answer

        Raises:
            ApiError: The server is up but its storage is not ``error`` is ``Health | RawError``."""
        return unwrap(self._with_raw_response.health(request_options=request_options))

    @property
    def with_raw_response(self) -> ServiceWithRawResponse:
        return self._with_raw_response


class AsyncService:
    def __init__(self, client: AsyncRawClient, server: Server) -> None:
        self._with_raw_response = AsyncServiceWithRawResponse(client, server)

    async def health(self, *, request_options: RequestOptionsOrDict | None = None) -> Health:
        """Send a ``GET`` request.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            The server and its storage answer

        Raises:
            ApiError: The server is up but its storage is not ``error`` is ``Health | RawError``."""
        return unwrap(await self._with_raw_response.health(request_options=request_options))

    @property
    def with_raw_response(self) -> AsyncServiceWithRawResponse:
        return self._with_raw_response


class ServiceWithRawResponse(BaseRawResponse[RawClient, Server]):
    def health(self, *, request_options: RequestOptionsOrDict | None = None) -> ApiResult[Health, HealthErrorBody]:
        """Send a ``GET`` request.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="GET",
            url_template=self._server.default("/api/health"),
            decoder=json_decoder[Health],
            error_mapper=health_error_mapper,
            request_options=request_options,
        )


class AsyncServiceWithRawResponse(BaseRawResponse[AsyncRawClient, Server]):
    async def health(
        self, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[Health, HealthErrorBody]:
        """Send a ``GET`` request.

        Args:
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="GET",
            url_template=self._server.default("/api/health"),
            decoder=async_json_decoder[Health],
            error_mapper=health_error_mapper,
            request_options=request_options,
        )
