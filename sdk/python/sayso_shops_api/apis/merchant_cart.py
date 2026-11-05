from __future__ import annotations

from uuid import UUID, uuid4

from ..core import (
    ApiResult,
    AsyncRawClient,
    BaseRawResponse,
    RawClient,
    RequestOptionsOrDict,
    async_json_decoder,
    json_body,
    json_decoder,
    param,
    unwrap,
)
from ..errors.checkout_error import CheckoutErrorBody, checkout_error_mapper
from ..errors.create_cart_error import CreateCartErrorBody, create_cart_error_mapper
from ..errors.get_cart_error import GetCartErrorBody, get_cart_error_mapper
from ..errors.update_cart_error import UpdateCartErrorBody, update_cart_error_mapper
from ..models.cart import Cart
from ..models.cart_request import CartRequest, CartRequestDict
from ..models.checkout_request import CheckoutRequest, CheckoutRequestDict
from ..models.checkout_result import CheckoutResult
from ..server.server import Server


class MerchantCart:
    def __init__(self, client: RawClient, server: Server) -> None:
        self._with_raw_response = MerchantCartWithRawResponse(client, server)

    def checkout(
        self,
        slug: str,
        cart_id: str,
        body: CheckoutRequest | CheckoutRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> CheckoutResult:
        """Call after the buyer approved in PayPal. Sayso re-checks stock and price, authorizes the payment, takes the
        stock and submits the capture to the shop's Guard. Big orders may wait for the owner: then ``payment_status`` is
        ``AUTHORIZED_PENDING_MERCHANT_REVIEW`` and the buyer is charged only if the owner agrees. Calling it again for a
        completed cart returns the same result; it never charges twice.

        Args:
            slug: The shop, e.g. maya-ceramics
            cart_id: From createCart, e.g. cart_6dadca42ea7819f7
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            The order was placed

        Raises:
            ApiError: No such published shop, or no such cart at this shop The order was not placed and the buyer was
                not charged: the buyer hasn't approved yet, the token doesn't match, or the cart changed (stock, price).
                The body is the cart with ``validation_issues``. PayPal refused or failed the call. ``debug_id`` helps
                PayPal support trace it. ``error`` is ``Error | Cart | RawError``."""
        return unwrap(self._with_raw_response.checkout(slug, cart_id, body, request_options=request_options))

    def create_cart(
        self,
        slug: str,
        body: CartRequest | CartRequestDict,
        *,
        x_sayso_channel: str | None = None,
        request_options: RequestOptionsOrDict | None = None,
    ) -> Cart:
        """Prices the cart from the shop's catalog (shipping and tax included) and validates it. A valid cart comes back
        ``CREATED`` with ``payment_method.approval_url``: send the buyer there to approve in PayPal. An invalid one
        comes back ``INCOMPLETE`` with ``validation_issues``, each with ``resolution_options`` an agent can apply before
        calling ``updateCart``.

        Args:
            slug: The shop, e.g. maya-ceramics
            body: The request body.
            x_sayso_channel: Which assistant or platform is shopping, shown to the shop owner (e.g. "chatgpt").
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            The priced cart

        Raises:
            ApiError: The request is malformed No such published shop, or no such cart at this shop PayPal refused or
                failed the call. ``debug_id`` helps PayPal support trace it. ``error`` is ``Error | RawError``."""
        return unwrap(
            self._with_raw_response.create_cart(
                slug, body, x_sayso_channel=x_sayso_channel, request_options=request_options
            ),
        )

    def get_cart(self, slug: str, cart_id: str, *, request_options: RequestOptionsOrDict | None = None) -> Cart:
        """The cart as it is now. Once paid, ``status`` is ``COMPLETED`` and ``payment_confirmation`` says which order
        it became, as the checkout answered.

        Args:
            slug: The shop, e.g. maya-ceramics
            cart_id: From createCart, e.g. cart_6dadca42ea7819f7
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            The cart

        Raises:
            ApiError: No such published shop, or no such cart at this shop ``error`` is ``Error | RawError``."""
        return unwrap(self._with_raw_response.get_cart(slug, cart_id, request_options=request_options))

    def update_cart(
        self,
        slug: str,
        cart_id: str,
        body: CartRequest | CartRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> Cart:
        """Replaces the whole cart, per the merchant-cart spec. A changed total gets a new PayPal approval link.

        Args:
            slug: The shop, e.g. maya-ceramics
            cart_id: From createCart, e.g. cart_6dadca42ea7819f7
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            The re-priced cart

        Raises:
            ApiError: No such published shop, or no such cart at this shop The cart is being paid and can't be changed;
                start a new cart The cart is already completed PayPal refused or failed the call. ``debug_id`` helps
                PayPal support trace it. ``error`` is ``Error | RawError``."""
        return unwrap(self._with_raw_response.update_cart(slug, cart_id, body, request_options=request_options))

    @property
    def with_raw_response(self) -> MerchantCartWithRawResponse:
        return self._with_raw_response


class AsyncMerchantCart:
    def __init__(self, client: AsyncRawClient, server: Server) -> None:
        self._with_raw_response = AsyncMerchantCartWithRawResponse(client, server)

    async def checkout(
        self,
        slug: str,
        cart_id: str,
        body: CheckoutRequest | CheckoutRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> CheckoutResult:
        """Call after the buyer approved in PayPal. Sayso re-checks stock and price, authorizes the payment, takes the
        stock and submits the capture to the shop's Guard. Big orders may wait for the owner: then ``payment_status`` is
        ``AUTHORIZED_PENDING_MERCHANT_REVIEW`` and the buyer is charged only if the owner agrees. Calling it again for a
        completed cart returns the same result; it never charges twice.

        Args:
            slug: The shop, e.g. maya-ceramics
            cart_id: From createCart, e.g. cart_6dadca42ea7819f7
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            The order was placed

        Raises:
            ApiError: No such published shop, or no such cart at this shop The order was not placed and the buyer was
                not charged: the buyer hasn't approved yet, the token doesn't match, or the cart changed (stock, price).
                The body is the cart with ``validation_issues``. PayPal refused or failed the call. ``debug_id`` helps
                PayPal support trace it. ``error`` is ``Error | Cart | RawError``."""
        return unwrap(await self._with_raw_response.checkout(slug, cart_id, body, request_options=request_options))

    async def create_cart(
        self,
        slug: str,
        body: CartRequest | CartRequestDict,
        *,
        x_sayso_channel: str | None = None,
        request_options: RequestOptionsOrDict | None = None,
    ) -> Cart:
        """Prices the cart from the shop's catalog (shipping and tax included) and validates it. A valid cart comes back
        ``CREATED`` with ``payment_method.approval_url``: send the buyer there to approve in PayPal. An invalid one
        comes back ``INCOMPLETE`` with ``validation_issues``, each with ``resolution_options`` an agent can apply before
        calling ``updateCart``.

        Args:
            slug: The shop, e.g. maya-ceramics
            body: The request body.
            x_sayso_channel: Which assistant or platform is shopping, shown to the shop owner (e.g. "chatgpt").
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            The priced cart

        Raises:
            ApiError: The request is malformed No such published shop, or no such cart at this shop PayPal refused or
                failed the call. ``debug_id`` helps PayPal support trace it. ``error`` is ``Error | RawError``."""
        return unwrap(
            await self._with_raw_response.create_cart(
                slug, body, x_sayso_channel=x_sayso_channel, request_options=request_options
            ),
        )

    async def get_cart(self, slug: str, cart_id: str, *, request_options: RequestOptionsOrDict | None = None) -> Cart:
        """The cart as it is now. Once paid, ``status`` is ``COMPLETED`` and ``payment_confirmation`` says which order
        it became, as the checkout answered.

        Args:
            slug: The shop, e.g. maya-ceramics
            cart_id: From createCart, e.g. cart_6dadca42ea7819f7
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            The cart

        Raises:
            ApiError: No such published shop, or no such cart at this shop ``error`` is ``Error | RawError``."""
        return unwrap(await self._with_raw_response.get_cart(slug, cart_id, request_options=request_options))

    async def update_cart(
        self,
        slug: str,
        cart_id: str,
        body: CartRequest | CartRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> Cart:
        """Replaces the whole cart, per the merchant-cart spec. A changed total gets a new PayPal approval link.

        Args:
            slug: The shop, e.g. maya-ceramics
            cart_id: From createCart, e.g. cart_6dadca42ea7819f7
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            The re-priced cart

        Raises:
            ApiError: No such published shop, or no such cart at this shop The cart is being paid and can't be changed;
                start a new cart The cart is already completed PayPal refused or failed the call. ``debug_id`` helps
                PayPal support trace it. ``error`` is ``Error | RawError``."""
        return unwrap(await self._with_raw_response.update_cart(slug, cart_id, body, request_options=request_options))

    @property
    def with_raw_response(self) -> AsyncMerchantCartWithRawResponse:
        return self._with_raw_response


class MerchantCartWithRawResponse(BaseRawResponse[RawClient, Server]):
    def checkout(
        self,
        slug: str,
        cart_id: str,
        body: CheckoutRequest | CheckoutRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiResult[CheckoutResult, CheckoutErrorBody]:
        """Call after the buyer approved in PayPal. Sayso re-checks stock and price, authorizes the payment, takes the
        stock and submits the capture to the shop's Guard. Big orders may wait for the owner: then ``payment_status`` is
        ``AUTHORIZED_PENDING_MERCHANT_REVIEW`` and the buyer is charged only if the owner agrees. Calling it again for a
        completed cart returns the same result; it never charges twice.

        Args:
            slug: The shop, e.g. maya-ceramics
            cart_id: From createCart, e.g. cart_6dadca42ea7819f7
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="POST",
            url_template=self._server.default("/api/shops/{slug}/merchant-cart/{cartId}/checkout"),
            path_params=[param[str]("slug", slug), param[str]("cartId", cart_id)],
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            body=json_body[CheckoutRequest | CheckoutRequestDict](body),
            decoder=json_decoder[CheckoutResult],
            error_mapper=checkout_error_mapper,
            request_options=request_options,
        )

    def create_cart(
        self,
        slug: str,
        body: CartRequest | CartRequestDict,
        *,
        x_sayso_channel: str | None = None,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiResult[Cart, CreateCartErrorBody]:
        """Prices the cart from the shop's catalog (shipping and tax included) and validates it. A valid cart comes back
        ``CREATED`` with ``payment_method.approval_url``: send the buyer there to approve in PayPal. An invalid one
        comes back ``INCOMPLETE`` with ``validation_issues``, each with ``resolution_options`` an agent can apply before
        calling ``updateCart``.

        Args:
            slug: The shop, e.g. maya-ceramics
            body: The request body.
            x_sayso_channel: Which assistant or platform is shopping, shown to the shop owner (e.g. "chatgpt").
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="POST",
            url_template=self._server.default("/api/shops/{slug}/merchant-cart"),
            path_params=[param[str]("slug", slug)],
            headers=[param[str | None]("X-Sayso-Channel", x_sayso_channel), param[UUID]("Idempotency-Key", uuid4())],
            body=json_body[CartRequest | CartRequestDict](body),
            decoder=json_decoder[Cart],
            error_mapper=create_cart_error_mapper,
            request_options=request_options,
        )

    def get_cart(
        self, slug: str, cart_id: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[Cart, GetCartErrorBody]:
        """The cart as it is now. Once paid, ``status`` is ``COMPLETED`` and ``payment_confirmation`` says which order
        it became, as the checkout answered.

        Args:
            slug: The shop, e.g. maya-ceramics
            cart_id: From createCart, e.g. cart_6dadca42ea7819f7
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="GET",
            url_template=self._server.default("/api/shops/{slug}/merchant-cart/{cartId}"),
            path_params=[param[str]("slug", slug), param[str]("cartId", cart_id)],
            decoder=json_decoder[Cart],
            error_mapper=get_cart_error_mapper,
            request_options=request_options,
        )

    def update_cart(
        self,
        slug: str,
        cart_id: str,
        body: CartRequest | CartRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiResult[Cart, UpdateCartErrorBody]:
        """Replaces the whole cart, per the merchant-cart spec. A changed total gets a new PayPal approval link.

        Args:
            slug: The shop, e.g. maya-ceramics
            cart_id: From createCart, e.g. cart_6dadca42ea7819f7
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return self._client.execute(
            http_method="PUT",
            url_template=self._server.default("/api/shops/{slug}/merchant-cart/{cartId}"),
            path_params=[param[str]("slug", slug), param[str]("cartId", cart_id)],
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            body=json_body[CartRequest | CartRequestDict](body),
            decoder=json_decoder[Cart],
            error_mapper=update_cart_error_mapper,
            request_options=request_options,
        )


class AsyncMerchantCartWithRawResponse(BaseRawResponse[AsyncRawClient, Server]):
    async def checkout(
        self,
        slug: str,
        cart_id: str,
        body: CheckoutRequest | CheckoutRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiResult[CheckoutResult, CheckoutErrorBody]:
        """Call after the buyer approved in PayPal. Sayso re-checks stock and price, authorizes the payment, takes the
        stock and submits the capture to the shop's Guard. Big orders may wait for the owner: then ``payment_status`` is
        ``AUTHORIZED_PENDING_MERCHANT_REVIEW`` and the buyer is charged only if the owner agrees. Calling it again for a
        completed cart returns the same result; it never charges twice.

        Args:
            slug: The shop, e.g. maya-ceramics
            cart_id: From createCart, e.g. cart_6dadca42ea7819f7
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="POST",
            url_template=self._server.default("/api/shops/{slug}/merchant-cart/{cartId}/checkout"),
            path_params=[param[str]("slug", slug), param[str]("cartId", cart_id)],
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            body=json_body[CheckoutRequest | CheckoutRequestDict](body),
            decoder=async_json_decoder[CheckoutResult],
            error_mapper=checkout_error_mapper,
            request_options=request_options,
        )

    async def create_cart(
        self,
        slug: str,
        body: CartRequest | CartRequestDict,
        *,
        x_sayso_channel: str | None = None,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiResult[Cart, CreateCartErrorBody]:
        """Prices the cart from the shop's catalog (shipping and tax included) and validates it. A valid cart comes back
        ``CREATED`` with ``payment_method.approval_url``: send the buyer there to approve in PayPal. An invalid one
        comes back ``INCOMPLETE`` with ``validation_issues``, each with ``resolution_options`` an agent can apply before
        calling ``updateCart``.

        Args:
            slug: The shop, e.g. maya-ceramics
            body: The request body.
            x_sayso_channel: Which assistant or platform is shopping, shown to the shop owner (e.g. "chatgpt").
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="POST",
            url_template=self._server.default("/api/shops/{slug}/merchant-cart"),
            path_params=[param[str]("slug", slug)],
            headers=[param[str | None]("X-Sayso-Channel", x_sayso_channel), param[UUID]("Idempotency-Key", uuid4())],
            body=json_body[CartRequest | CartRequestDict](body),
            decoder=async_json_decoder[Cart],
            error_mapper=create_cart_error_mapper,
            request_options=request_options,
        )

    async def get_cart(
        self, slug: str, cart_id: str, *, request_options: RequestOptionsOrDict | None = None
    ) -> ApiResult[Cart, GetCartErrorBody]:
        """The cart as it is now. Once paid, ``status`` is ``COMPLETED`` and ``payment_confirmation`` says which order
        it became, as the checkout answered.

        Args:
            slug: The shop, e.g. maya-ceramics
            cart_id: From createCart, e.g. cart_6dadca42ea7819f7
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="GET",
            url_template=self._server.default("/api/shops/{slug}/merchant-cart/{cartId}"),
            path_params=[param[str]("slug", slug), param[str]("cartId", cart_id)],
            decoder=async_json_decoder[Cart],
            error_mapper=get_cart_error_mapper,
            request_options=request_options,
        )

    async def update_cart(
        self,
        slug: str,
        cart_id: str,
        body: CartRequest | CartRequestDict,
        *,
        request_options: RequestOptionsOrDict | None = None,
    ) -> ApiResult[Cart, UpdateCartErrorBody]:
        """Replaces the whole cart, per the merchant-cart spec. A changed total gets a new PayPal approval link.

        Args:
            slug: The shop, e.g. maya-ceramics
            cart_id: From createCart, e.g. cart_6dadca42ea7819f7
            body: The request body.
            request_options: Per-call overrides for this one request, such as a timeout, extra headers, or its retry
                count and statuses.

        Returns:
            An ``ApiResult`` holding the deserialized response or the error body."""
        return await self._client.execute(
            http_method="PUT",
            url_template=self._server.default("/api/shops/{slug}/merchant-cart/{cartId}"),
            path_params=[param[str]("slug", slug), param[str]("cartId", cart_id)],
            headers=[param[UUID]("Idempotency-Key", uuid4())],
            body=json_body[CartRequest | CartRequestDict](body),
            decoder=async_json_decoder[Cart],
            error_mapper=update_cart_error_mapper,
            request_options=request_options,
        )
