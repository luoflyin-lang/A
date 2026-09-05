/**
 * TradeCore: 交易计算与风控纯函数内核
 * 支持浏览器与 Node.js 双环境
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TradeCore = factory();
  }
}(typeof self !== 'undefined' ? self : this, function() {
  "use strict";

  const TradeCore = {
    /**
     * 计算数字的小数位数精度
     */
    dec(v) {
      const n = +v;
      if (!isFinite(n) || n <= 0) return 8;
      const s = n.toFixed(12).replace(/0+$/, "");
      const i = s.indexOf(".");
      return i < 0 ? 0 : Math.max(0, s.length - i - 1);
    },

    /**
     * 数量精度对齐（向下截断到 stepSize）
     */
    alignSz(s, step) {
      const st = +step > 0 ? +step : 1e-8;
      const d = this.dec(st);
      return +(Math.floor((+s) / st + 1e-9) * st).toFixed(d);
    },

    /**
     * 价格精度对齐（按 tickSize，支持方向：dir < 0 向下，dir > 0 向上，0 四舍五入）
     */
    alignPx(p, tick, dir) {
      const n = +p;
      if (!isFinite(n) || n <= 0) return 0;
      const tk = +tick > 0 ? +tick : 0.01;
      const d = this.dec(tk);
      const r = dir ? (dir < 0 ? Math.floor(n / tk + 1e-9) : Math.ceil(n / tk - 1e-9)) : Math.round(n / tk);
      if (!(r > 0)) return 0;
      return +(r * tk).toFixed(d);
    },

    /**
     * 估算强平价格 (Liquidation Price)
     * entry: 入场价, lev: 杠杆倍数, isLong: 是否做多, mmr: 维持保证金率 (默认 0.4%)
     */
    estLiqPrice(entry, lev, isLong, mmr = 0.004) {
      const e = +entry;
      const l = Math.max(1, +lev);
      if (!(e > 0)) return 0;
      if (isLong) {
        return Math.max(0, e * (1 - 1 / l + mmr));
      } else {
        return e * (1 + 1 / l - mmr);
      }
    },

    /**
     * 校验爆仓距离与止损距离的安全性
     * 规则: |Liq - Entry| > minRatio * |SL - Entry| (默认 minRatio = 1.5)
     */
    checkLiqSafety(entry, sl, lev, isLong, minRatio = 1.5, mmr = 0.004) {
      const e = +entry, s = +sl, l = Math.max(1, +lev);
      if (!(e > 0) || !(s > 0)) return { safe: false, reason: "价格无效" };
      const slDist = Math.abs(e - s);
      if (slDist <= 0) return { safe: false, reason: "止损价不能等于入场价" };
      
      const liq = this.estLiqPrice(e, l, isLong, mmr);
      const liqDist = Math.abs(liq - e);

      // 方向有效性：止损必须先于爆仓发生
      if (isLong && s <= liq) {
        return { safe: false, safeRatio: 0, liq, liqDist, slDist, reason: "止损价 (" + s + ") 低于或等于强平价 (" + liq.toFixed(4) + ")，会先爆仓后止损！" };
      }
      if (!isLong && s >= liq) {
        return { safe: false, safeRatio: 0, liq, liqDist, slDist, reason: "止损价 (" + s + ") 高于或等于强平价 (" + liq.toFixed(4) + ")，会先爆仓后止损！" };
      }

      const ratio = liqDist / slDist;
      if (ratio < minRatio) {
        return {
          safe: false,
          safeRatio: ratio,
          liq,
          liqDist,
          slDist,
          reason: "强平距离 (" + liqDist.toFixed(4) + ") 不足止损距离 (" + slDist.toFixed(4) + ") 的 " + minRatio + " 倍（当前 " + ratio.toFixed(2) + "x），存在插针爆仓风险！"
        };
      }
      return { safe: true, safeRatio: ratio, liq, liqDist, slDist };
    },

    /**
     * 计算满足 1.5 倍爆仓安全距离的最大允许杠杆
     */
    maxSafeLev(entry, sl, isLong, minRatio = 1.5, mmr = 0.004, hardCap = 125) {
      const e = +entry, s = +sl;
      const slDist = Math.abs(e - s);
      if (!(e > 0) || slDist <= 0) return Math.min(20, hardCap);
      const denominator = (minRatio * slDist / e) + mmr;
      if (denominator <= 0) return hardCap;
      const maxL = Math.floor(1 / denominator);
      return Math.max(1, Math.min(maxL, hardCap));
    },

    /**
     * 从风险预算反推止损价（用于看门狗保底逃生）
     */
    riskBudgetSl(entry, qty, equity, riskPct = 1.0, isLong = true) {
      const e = +entry, q = Math.abs(+qty), eq = +equity;
      if (!(e > 0) || !(q > 0) || !(eq > 0)) return null;
      const budget = eq * (riskPct / 100);
      const deltaP = budget / q;
      if (isLong) {
        const sl = e - deltaP;
        return sl > 0 ? sl : e * 0.985;
      } else {
        return e + deltaP;
      }
    },

    /**
     * 核心仓位计算
     */
    sizing(i) {
      const r = { e: i.entry, sl: i.sl, tp: i.tp, risk: i.riskPct, reasons: [], ok: false };
      const isLong = i.sl != null && i.entry != null ? (+i.sl < +i.entry) : true;

      // 1. 基础参数与杠杆校验
      let lev = Math.max(1, Math.min(+i.lev || 1, +i.maxLev || +i.lev || 1));
      if (!i.equity || !(+i.equity > 0)) r.reasons.push("未加载账户资金");
      if (r.e == null || r.sl == null) {
        r.reasons.push("入场或止损未选");
        r.lev = lev;
        return r;
      }

      // 2. 价格先进行 tick 对齐，消除精度与滑步误差
      const alignedE = this.alignPx(r.e, i.tick, isLong ? -1 : 1);
      const alignedSl = this.alignPx(r.sl, i.tick, isLong ? 1 : -1);
      r.e = alignedE;
      r.sl = alignedSl;

      const dist = Math.abs(r.e - r.sl);
      if (!dist || !isFinite(dist) || dist <= 0) {
        r.bad = true;
        r.reasons.push("止损 = 入场价，无效");
        r.lev = lev;
        return r;
      }
      r.dist = dist;

      // 3. 爆仓价与止损价安全距离硬校验（防先爆仓后止损）
      const liqCheck = this.checkLiqSafety(r.e, r.sl, lev, isLong, 1.5);
      if (!liqCheck.safe) {
        const safeLev = this.maxSafeLev(r.e, r.sl, isLong, 1.5, 0.004, +i.maxLev || 125);
        if (safeLev < lev) {
          lev = safeLev;
          r.capped = (r.capped ? r.capped + "；" : "") + "止损较远，为防爆仓已自动降杠杆至 " + lev + "x";
        } else {
          r.reasons.push(liqCheck.reason);
        }
      }
      r.lev = lev;
      r.liq = this.estLiqPrice(r.e, lev, isLong);

      // 4. 仓位大小计算（以 1% 净值预算除以每单位风险）
      const feeRt = (+i.feeRate || 0) * 2;
      const perUnit = dist + r.e * feeRt;
      const budget = (+i.equity || 0) * (+i.riskPct || 0) / 100;
      r.budget = budget;
      let size = this.alignSz(perUnit > 0 ? budget / perUnit : 0, i.step);
      if (!(size > 0)) {
        r.size = 0;
        r.reasons.push("数量小于最小下单精度（stepSize=" + (i.step || 0) + "）");
        return r;
      }

      // 5. 可用保证金约束校验与缩仓
      const avail = i.availableMargin != null ? +i.availableMargin : +i.equity || 0;
      let notional = size * r.e;
      let margin = notional / lev;
      if (margin + notional * feeRt > avail) {
        const maxSize = this.alignSz(avail * lev / (r.e * (1 + lev * feeRt)), i.step);
        if (maxSize > 0 && maxSize < size) {
          size = maxSize;
          notional = size * r.e;
          margin = notional / lev;
          r.capped = (r.capped ? r.capped + "；" : "") + "可用保证金不足，已按可用保证金缩仓";
        } else if (!(maxSize > 0)) {
          r.size = 0;
          r.reasons.push("可用保证金不足");
          return r;
        }
      }

      // 6. 最大/最小下单量与最小名义价值校验
      if (+i.maxQty > 0 && size > +i.maxQty) {
        size = this.alignSz(+i.maxQty, i.step);
        notional = size * r.e;
        margin = notional / lev;
        r.capped = (r.capped ? r.capped + "；" : "") + "已按品种单笔上限缩仓";
      }
      if (+i.minQty > 0 && size < +i.minQty) {
        r.reasons.push("数量 " + size + " 低于最小下单量 " + i.minQty);
      }
      const minN = +i.minNotional || 0;
      if (notional < minN) {
        r.reasons.push("名义价值 " + notional.toFixed(2) + " 低于最小 " + minN);
      }

      r.size = size;
      r.notional = notional;
      r.margin = margin;
      r.fee = notional * feeRt;
      r.riskUsd = size * dist + r.fee;

      // 7. 止盈有效性校验与盈亏比计算
      if (i.tp != null) {
        const alignedTp = this.alignPx(i.tp, i.tick, isLong ? 1 : -1);
        r.tp = alignedTp;
        const good = isLong ? (alignedTp > r.e) : (alignedTp < r.e);
        if (!good) {
          r.reasons.push("止盈方向错误（应在入场价的盈利一侧）");
        } else {
          r.rr = Math.abs(alignedTp - r.e) / dist;
        }
      }

      r.ok = r.reasons.length === 0 && size > 0;
      return r;
    }
  };

  return TradeCore;
}));
