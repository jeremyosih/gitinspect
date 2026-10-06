# Vendored packages

## effect-pi-durable-0.1.0.tgz

[effect-pi-durable](https://github.com/jeremyosih/effect-pi-durable) is the Effect API for Pi Durable that the browser agent uses. It is not published to npm, and its repository does not commit its build output, so `packages/runtime` depends on this tarball.

- Source: commit `6e4558ce63713c014d39192d1d4008d4764957a9`.
- Built with `bun install && bun run build && bun pm pack`.
- One change from that commit: the `effect` peer and development versions are `4.0.0` (`^4.0.0` for the peer) where the source pins `4.0.0-rc.112`. The package's typecheck and its 870 tests pass on Effect 4.0.0, and the app needs one copy of Effect.

Once the package is published, replace the `file:` dependency in `packages/runtime/package.json` with its version and delete this directory.
