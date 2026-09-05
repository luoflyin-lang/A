const assert = require("assert");
const TradeCore = require("./trade-core.js");

console.log("=== Running TradeCore Comprehensive Test Suite ===");

// Test 1: Decimal Precision & Alignment
{
  assert.strictEqual(TradeCore.dec(0.001), 3);
  assert.strictEqual(TradeCore.dec(0.0001), 4);
  assert.strictEqual(TradeCore.dec(1), 0);
  assert.strictEqual(TradeCore.dec(0.1), 1);

  assert.strictEqual(TradeCore.alignSz(1.23456, 0.001), 1.234);
  assert.strictEqual(TradeCore.alignSz(1.23499, 0.01), 1.23);

  assert.strictEqual(TradeCore.alignPx(100.254, 0.01, 0), 100.25);
  assert.strictEqual(TradeCore.alignPx(100.254, 0.01, -1), 100.25); // floor
  assert.strictEqual(TradeCore.alignPx(100.251, 0.01, 1), 100.26);  // ceil
  console.log("✔ Test 1 passed: Precision and alignment");
}

// Test 2: Liquidation Estimation & Safety Ratio
{
  // 100 entry, 20x lev, Long. Liq approx 100 * (1 - 0.05 + 0.004) = 95.4
  const liqLong = TradeCore.estLiqPrice(100, 20, true, 0.004);
  assert(Math.abs(liqLong - 95.4) < 1e-4, `Expected 95.4, got ${liqLong}`);

  // Safe SL: entry 100, sl 98 (dist 2). Liq dist = 4.6. Ratio = 4.6 / 2 = 2.3 > 1.5 -> safe
  const safeRes = TradeCore.checkLiqSafety(100, 98, 20, true, 1.5, 0.004);
  assert.strictEqual(safeRes.safe, true);

  // Unsafe SL: entry 100, sl 96 (dist 4). Liq dist = 4.6. Ratio = 4.6 / 4 = 1.15 < 1.5 -> unsafe
  const unsafeRes = TradeCore.checkLiqSafety(100, 96, 20, true, 1.5, 0.004);
  assert.strictEqual(unsafeRes.safe, false);

  // Auto Safe Leverage calculation: for entry 100, sl 96 (dist 4), minRatio 1.5 -> safeLev should be ~15x
  const safeL = TradeCore.maxSafeLev(100, 96, true, 1.5, 0.004, 125);
  assert(safeL <= 15, `Expected <= 15x, got ${safeL}x`);
  console.log("✔ Test 2 passed: Liquidation estimation and safety ratio");
}

// Test 3: Sizing with 1% Risk Budget and Auto Leverage Adjustment
{
  const input = {
    equity: 10000,
    riskPct: 1.0, // $100 risk
    entry: 100,
    sl: 95, // 5% stop distance
    tp: 110,
    lev: 20,
    maxLev: 20,
    step: 0.001,
    tick: 0.01,
    minQty: 0.01,
    maxQty: 10000,
    minNotional: 5,
    feeRate: 0.00025,
    availableMargin: 10000
  };

  const r = TradeCore.sizing(input);
  assert.strictEqual(r.ok, true);
  // Because 5% SL is far for 20x (liq is 95.4, SL 95 is below liq!), it must have automatically reduced leverage!
  assert(r.lev < 20, `Expected auto-reduced leverage < 20, got ${r.lev}`);
  assert(r.capped && r.capped.includes("降杠杆"), "Should have auto-downgraded leverage reason");
  assert(r.riskUsd <= 101, `Risk USD should be bounded around $100, got ${r.riskUsd}`);
  console.log("✔ Test 3 passed: Auto leverage adjustment for far stop loss");
}

// Test 4: Reverse Engineer SL from Risk Budget (Watchdog fallback)
{
  // Equity $10000, 1% risk = $100.
  // Position = 10 units at entry $100.
  // DeltaP = $100 / 10 = $10.
  // Long SL should be 100 - 10 = 90.
  const slLong = TradeCore.riskBudgetSl(100, 10, 10000, 1.0, true);
  assert.strictEqual(slLong, 90);

  // Short SL should be 100 + 10 = 110.
  const slShort = TradeCore.riskBudgetSl(100, 10, 10000, 1.0, false);
  assert.strictEqual(slShort, 110);
  console.log("✔ Test 4 passed: Reverse engineering SL from risk budget");
}

console.log("=== All TradeCore Tests Passed! ===");
