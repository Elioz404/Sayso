import { ApiError, type Declared, type Undeclared } from "../core/api-error.js";
import type { ApiPromise } from "../core/api-promise.js";
import type { RequestOptions } from "../core/api-request.js";
import { noneAuth } from "../core/auth/schemes.js";
import type { RawClient } from "../core/raw-client.js";
import type { ErrorDecoders } from "../core/response-decoder.js";
import { healthSchema, type Health } from "../models/health.js";
import type { Servers } from "../servers.js";

/**
 * Is the server up.
 */
export class Service {
  readonly #rawClient: RawClient;
  readonly #servers: Servers;

  constructor(rawClient: RawClient, servers: Servers) {
    this.#rawClient = rawClient;
    this.#servers = servers;
  }

  /**
   * Health check
   *
   * @returns The server and its storage answer
   *
   * @throws {@link Service.HealthApiError} when the API answers with an error status — narrow on
   * `err.payload.kind`
   *
   * @throws {@link SaysoShopsApiError} when no usable response was produced: a connection failure,
   * a timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  health(options?: RequestOptions): ApiPromise<Health, Service.HealthApiError> {
    return this.#rawClient.execute(
      {
        method: "GET",
        urlTemplate: this.#servers.default("/api/health"),
        auth: noneAuth,
        pathParams: [],
        query: [],
        headers: [],
        body: { kind: "empty" },
      },
      {
        success: { kind: "json", schema: healthSchema },
        errorFactory: Service.HealthApiError,
      },
      options,
    );
  }
}

export namespace Service {
  export class HealthApiError extends ApiError {
    declare readonly payload: Declared<"health", Health> | Undeclared;

    static readonly errors: ErrorDecoders<HealthApiError> = [
      { on: 503, kind: "health", decode: { kind: "json", schema: healthSchema } },
    ];
  }
}
