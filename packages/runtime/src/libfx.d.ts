declare module "libfx/browser" {
  export function supportsJspi(): boolean;
  export function createFxAgent(
    options: import("./agent/fx-types").FxOptions,
  ): Promise<import("./agent/fx-types").FxAgent>;
}

declare module "libfx/fx-core.wasm?url" {
  const url: string;
  export default url;
}
