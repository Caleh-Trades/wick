import { dailyReturns, pairedReturns, pearson } from "@/lib/correlation"
import type { TapeCandle } from "@/lib/types"

export function CorrelationPage({
  series,
  pending,
}: {
  series: Array<{ symbol: string; candles: TapeCandle[] }>
  pending: boolean
}) {
  const names = series.map((item) => item.symbol.replace(/USDT$/, ""))
  const returns = series.map((item) => dailyReturns(item.candles, 30))
  const cells = names.map((_, row) =>
    names.map((__, column) => {
      if (row === column) return 1
      if (column < row) return null
      return pearson(pairedReturns(returns[row] ?? new Map(), returns[column] ?? new Map()))
    }),
  )

  return (
    <div className="desk-stack lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-4 px-4 py-4 pb-16">
        <div>
          <h2 className="font-mono text-xs tracking-[0.28em] text-[#c56a32] uppercase">Correlation</h2>
          <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
            Pairwise correlation of the last 30 daily returns. One number per pair. A missing day is left out of that pair.
          </p>
        </div>
        {pending ? <p className="text-sm text-muted-foreground">Waiting for daily bars.</p> : null}
        {!pending && names.length < 2 ? (
          <p className="text-sm text-muted-foreground">Pin a second symbol. Correlation uses the active slot’s pin set.</p>
        ) : null}
        {names.length >= 2 ? (
          <div className="overflow-x-auto" aria-label="30-day return correlation">
            <table className="border-collapse text-left">
              <thead>
                <tr>
                  <th className="p-2" />
                  {names.map((name) => (
                    <th key={name} className="p-2 font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
                      {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {names.map((name, row) => (
                  <tr key={name}>
                    <th className="p-2 text-left font-mono text-[11px] tracking-wide text-muted-foreground uppercase">{name}</th>
                    {names.map((other, column) => {
                      const value = cells[row]?.[column]
                      const shown = column < row ? cells[column]?.[row] : value
                      return (
                        <td
                          key={other}
                          className="p-2 text-center font-mono text-xs tabular-nums"
                          style={{ background: heat(column === row ? 1 : shown ?? null) }}
                        >
                          {column < row ? "" : shown == null ? "—" : shown.toFixed(2)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function heat(value: number | null): string {
  if (value == null) return "transparent"
  const mag = Math.min(1, Math.abs(value))
  return value >= 0 ? `rgba(62, 224, 162, ${0.12 + mag * 0.55})` : `rgba(255, 93, 115, ${0.12 + mag * 0.55})`
}
