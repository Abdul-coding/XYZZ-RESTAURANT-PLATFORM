export type BillLine = {
  menuItemId: string;
  quantity: number;
  variantId?: string;
  addonIds?: string[];
};

function lineKey(line: BillLine) {
  const addons = [...(line.addonIds ?? [])].sort().join(',');
  return `${line.menuItemId}|${line.variantId ?? ''}|${addons}`;
}

export function mergeBillItems(existing: BillLine[], incoming: BillLine[]): BillLine[] {
  const merged = existing.map((line) => ({
    ...line,
    addonIds: line.addonIds ? [...line.addonIds] : [],
  }));
  const index = new Map(merged.map((line, i) => [lineKey(line), i]));
  for (const line of incoming) {
    const key = lineKey(line);
    const at = index.get(key);
    if (at === undefined) {
      index.set(key, merged.length);
      merged.push({
        menuItemId: line.menuItemId,
        quantity: line.quantity,
        variantId: line.variantId,
        addonIds: line.addonIds ? [...line.addonIds] : [],
      });
    } else {
      merged[at].quantity += line.quantity;
    }
  }
  return merged;
}
