import type { CoreClientOptions } from "./core/client-options.js";

export type ClientOptions = SdkClientOptions & CoreClientOptions;

type SdkClientOptions = ServerOptions;

type ServerOptions = {
  /** A Sayso server running locally. Point clients at your own Sayso server's address instead. */
  readonly serverOptions?: {
    baseUrl?: string;
  };
};
