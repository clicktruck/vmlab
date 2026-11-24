import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Fetch, hourlyPrice } from './pricing.ts';

// Shaped like the real answer from prices.azure.com for Standard_B2s in eastus2, read 2026-11-23.
const body = {
  Items: [
    {
      retailPrice: 0.0496,
      unitOfMeasure: '1 Hour',
      productName: 'Virtual Machines BS Series Windows',
      meterName: 'B2s',
    },
    {
      retailPrice: 0.0416,
      unitOfMeasure: '1 Hour',
      productName: 'Virtual Machines BS Series',
      meterName: 'B2s',
    },
    {
      retailPrice: 0.0042,
      unitOfMeasure: '1 Hour',
      productName: 'Virtual Machines BS Series Windows',
      meterName: 'B2s Spot',
    },
    {
      retailPrice: 0.9,
      unitOfMeasure: '1 Month',
      productName: 'Virtual Machines BS Series Windows',
      meterName: 'B2s',
    },
  ],
  NextPageLink: null,
};
const ok: Fetch = async () => ({ ok: true, json: async () => body });

test('Windows takes the Windows rate and Linux the other, never Spot, never a monthly price', async () => {
  assert.equal(await hourlyPrice(ok, { location: 'eastus2', size: 'Standard_B2s', windows: true }), 0.0496);
  assert.equal(await hourlyPrice(ok, { location: 'eastus2', size: 'Standard_B2s', windows: false }), 0.0416);
});

test('a price that cannot be read is unknown, not zero', async () => {
  assert.equal(
    await hourlyPrice(async () => ({ ok: false, json: async () => ({}) }), {
      location: 'x',
      size: 'y',
      windows: true,
    }),
    null,
  );
  assert.equal(
    await hourlyPrice(
      async () => {
        throw new Error('offline');
      },
      { location: 'x', size: 'y', windows: true },
    ),
    null,
  );
  assert.equal(
    await hourlyPrice(async () => ({ ok: true, json: async () => ({ Items: [] }) }), {
      location: 'x',
      size: 'y',
      windows: true,
    }),
    null,
  );
});

test('the query is for the right size and region and names no spot or low-priority price', async () => {
  let asked = '';
  await hourlyPrice(
    async (url) => {
      asked = url;
      return { ok: true, json: async () => ({ Items: [] }) };
    },
    { location: 'eastus2', size: 'Standard_B2s', windows: true },
  );
  const decoded = decodeURIComponent(asked);
  assert.match(decoded, /armRegionName eq 'eastus2'/);
  assert.match(decoded, /armSkuName eq 'Standard_B2s'/);
  assert.match(decoded, /priceType eq 'Consumption'/);
});
