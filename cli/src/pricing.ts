// Azure's own public price list (no sign-in): https://prices.azure.com/api/retail/prices
// Used only to estimate a run's cost for the plan. If it cannot be read, the cost is a gap, never zero.

type Item = {
  retailPrice: number;
  unitOfMeasure: string;
  productName: string;
  meterName: string;
};
type Page = { Items: Item[]; NextPageLink?: string | null };
export type Fetch = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/**
 * The hourly price of one machine size in one region. For Windows it returns the Windows rate, which is
 * the higher of the two, so the estimate is an upper bound (a machine that brings its own Windows licence
 * is expected to be billed at the lower rate; that was not verified).
 */
export async function hourlyPrice(
  fetchFn: Fetch,
  q: { location: string; size: string; windows: boolean },
): Promise<number | null> {
  const filter = [
    "serviceName eq 'Virtual Machines'",
    `armRegionName eq '${q.location}'`,
    `armSkuName eq '${q.size}'`,
    "priceType eq 'Consumption'",
  ].join(' and ');
  let url: string | null = `https://prices.azure.com/api/retail/prices?$filter=${encodeURIComponent(filter)}`;
  const prices: number[] = [];
  try {
    for (let page = 0; url && page < 5; page++) {
      const res = await fetchFn(url);
      if (!res.ok) return null;
      const body = (await res.json()) as Page;
      for (const item of body.Items ?? []) {
        if (/spot|low priority/i.test(item.meterName)) continue;
        if (item.unitOfMeasure !== '1 Hour') continue;
        if (/ Windows$/.test(item.productName) !== q.windows) continue;
        prices.push(item.retailPrice);
      }
      url = body.NextPageLink ?? null;
    }
  } catch {
    return null;
  }
  return prices.length ? Math.min(...prices) : null;
}
