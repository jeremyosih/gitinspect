import "dotenv/config";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import type { ShareDO } from "../../apps/sharing/src/index";

// Only the sharing service. The web app's hosting remains an independent decision.
export const sharing = Cloudflare.Worker("sharing", {
  main: "../../apps/sharing/src/index.ts",
  compatibility: { date: "2026-07-30", flags: ["nodejs_compat"] },
  env: {
    SHARES: Cloudflare.DurableObject<ShareDO>("SHARES", { className: "ShareDO" }),
    SHARING_SERVICE_SECRET: Config.Redacted("SHARING_SERVICE_SECRET"),
  },
  dev: { port: 3002 },
}).pipe(Alchemy.RemovalPolicy.retain());

export default Alchemy.Stack(
  "gitinspect-sharing",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const worker = yield* sharing;
    return { sharingServiceUrl: worker.url };
  }),
);
