import { getDateKey } from "@gitinspect/pi/lib/dates";
import type { ProviderId, Usage } from "@gitinspect/pi/types/models";
import { db } from "./db";
import type { DailyCostAggregate } from "./types";

export async function getDailyCost(date: string): Promise<DailyCostAggregate | undefined> {
  return await db.dailyCosts.get(date);
}

export function mergeDailyCostAggregate(
  current: DailyCostAggregate | undefined,
  usage: Usage,
  provider: ProviderId,
  model: string,
  at: Date | number | string = Date.now(),
): DailyCostAggregate {
  const date = getDateKey(at);
  const providerTotals = current?.byProvider[provider] ?? {};
  const nextByProvider = {
    ...current?.byProvider,
    [provider]: {
      ...providerTotals,
      [model]: (providerTotals[model] ?? 0) + usage.cost.total,
    },
  };

  return {
    byProvider: nextByProvider,
    date,
    total: (current?.total ?? 0) + usage.cost.total,
  };
}

export async function recordUsage(
  usage: Usage,
  provider: ProviderId,
  model: string,
  at = Date.now(),
): Promise<void> {
  const date = getDateKey(at);
  const current = await db.dailyCosts.get(date);
  const next = mergeDailyCostAggregate(current, usage, provider, model, at);
  await db.dailyCosts.put(next);
}

export async function listDailyCosts(): Promise<DailyCostAggregate[]> {
  return await db.dailyCosts.orderBy("date").reverse().toArray();
}

export function getTotalCostFromAggregates(dailyCosts: DailyCostAggregate[]): number {
  return dailyCosts.reduce((total, daily) => total + daily.total, 0);
}

export async function getTotalCost(): Promise<number> {
  return getTotalCostFromAggregates(await listDailyCosts());
}

export function getCostsByProviderFromAggregates(
  dailyCosts: DailyCostAggregate[],
): Partial<Record<ProviderId, number>> {
  const totals: Partial<Record<ProviderId, number>> = {};

  for (const daily of dailyCosts) {
    for (const [provider, models] of Object.entries(daily.byProvider) as Array<
      [ProviderId, Record<string, number> | undefined]
    >) {
      const sum = Object.values(models ?? {}).reduce((subtotal, value) => subtotal + value, 0);
      totals[provider] = (totals[provider] ?? 0) + sum;
    }
  }

  return totals;
}

export async function getCostsByProvider(): Promise<Partial<Record<ProviderId, number>>> {
  return getCostsByProviderFromAggregates(await listDailyCosts());
}

export function getCostsByModelFromAggregates(
  dailyCosts: DailyCostAggregate[],
): Record<string, number> {
  const totals: Record<string, number> = {};

  for (const daily of dailyCosts) {
    for (const models of Object.values(daily.byProvider)) {
      for (const [model, value] of Object.entries(models ?? {})) {
        totals[model] = (totals[model] ?? 0) + value;
      }
    }
  }

  return totals;
}

export async function getCostsByModel(): Promise<Record<string, number>> {
  return getCostsByModelFromAggregates(await listDailyCosts());
}
