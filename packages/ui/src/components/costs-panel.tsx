import { useLiveQuery } from "dexie-react-hooks";
import { listDailyCosts } from "@gitinspect/db";
import type { SessionData } from "@gitinspect/db";

export function CostsPanel({ session }: { session?: SessionData }) {
  const dailyCosts = useLiveQuery(async () => await listDailyCosts(), []);

  return (
    <div className="space-y-4">
      {session ? (
        <div className="border border-foreground/10 p-4">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Active session
          </div>
          <div className="mt-2 text-2xl font-medium">${session.cost.toFixed(4)}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {session.usage.totalTokens.toLocaleString()} total tokens
          </div>
        </div>
      ) : (
        <div className="border border-foreground/10 p-4 text-xs text-muted-foreground">
          Open a repository workspace to see per-session cost for the active chat.
        </div>
      )}
      <div className="border border-foreground/10 p-4">
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          Daily totals
        </div>
        <div className="mt-4 space-y-3">
          {(dailyCosts ?? []).map((daily) => (
            <div className="border border-foreground/10 px-3 py-3 text-xs" key={daily.date}>
              <div className="flex items-center justify-between">
                <span>{daily.date}</span>
                <span>${daily.total.toFixed(4)}</span>
              </div>
              <div className="mt-2 space-y-1 text-muted-foreground">
                {Object.entries(daily.byProvider).map(([provider, models]) =>
                  Object.entries(models ?? {}).map(([model, cost]) => (
                    <div className="flex items-center justify-between" key={`${provider}-${model}`}>
                      <span>
                        {provider} · {model}
                      </span>
                      <span>${cost.toFixed(4)}</span>
                    </div>
                  )),
                )}
              </div>
            </div>
          ))}
          {dailyCosts?.length ? null : (
            <div className="text-xs text-muted-foreground">
              No completed assistant messages recorded yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
