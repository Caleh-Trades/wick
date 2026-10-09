import assert from "node:assert/strict"

import { isHiddenMarket, isLeveragedToken, isTokenizedStock, matchRank, orderMarkets } from "../src/lib/market-search.ts"

const bases = new Set(["BTC", "ETH", "SOL", "JUP", "SYRUP", "BNB", "SHIB"])

assert.equal(isLeveragedToken("BTCUP", bases), true)
assert.equal(isLeveragedToken("ETHDOWN", bases), true)
assert.equal(isLeveragedToken("SOLBULL", bases), true)
assert.equal(isLeveragedToken("BNBBULL", bases), true)
assert.equal(isLeveragedToken("JUP", bases), false)
assert.equal(isLeveragedToken("SYRUP", bases), false)
assert.equal(isTokenizedStock("AAPLB"), true)
assert.equal(isTokenizedStock("TSLAB"), true)
assert.equal(isTokenizedStock("SHIB"), false)
assert.equal(isTokenizedStock("BNB"), false)
assert.equal(isTokenizedStock("ARB"), false)
assert.equal(isHiddenMarket("AAPLB", bases), true)
assert.equal(isHiddenMarket("SOL", bases), false)

assert.equal(matchRank("SOL", "Solana", "sol"), 0)
assert.equal(matchRank("SOLV", undefined, "sol"), 1)
assert.equal(matchRank("BNSOL", undefined, "sol"), 3)
assert.equal(matchRank("RESOLV", undefined, "sol"), 3)
assert.equal(matchRank("ETH", "Ethereum", "sol"), null)
assert.equal(matchRank("ADA", "Cardano", "car"), 2)

const rows = [
  { id: "BNSOLUSDT", base: "BNSOL" },
  { id: "RESOLVUSDT", base: "RESOLV" },
  { id: "SOLVUSDT", base: "SOLV" },
  { id: "SOLUSDT", base: "SOL", name: "Solana" },
  { id: "AAPLBUSDT", base: "AAPLB" },
  { id: "ETHUSDT", base: "ETH", name: "Ethereum" },
]
const found = orderMarkets(rows, "sol", ["ETHUSDT"], false, bases)
assert.deepEqual(found.rest.map((row) => row.base), ["SOL", "SOLV", "BNSOL", "RESOLV"])
assert.deepEqual(found.pinned.map((row) => row.base), [])

const fav = orderMarkets(rows, "sol", ["BNSOLUSDT", "SOLUSDT"], false, bases)
assert.deepEqual(fav.pinned.map((row) => row.base), ["SOL", "BNSOL"])
assert.equal(fav.rest.some((row) => row.base === "SOL" || row.base === "BNSOL"), false)

const hidden = orderMarkets(rows, "", [], false, bases)
assert.equal(hidden.rest.some((row) => row.base === "AAPLB"), false)
const shown = orderMarkets(rows, "", [], true, bases)
assert.equal(shown.rest.some((row) => row.base === "AAPLB"), true)

const empty = orderMarkets(rows, "zzzz", [], true, bases)
assert.equal(empty.pinned.length + empty.rest.length, 0)

console.log("markets ok")
