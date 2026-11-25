[![make.fun](https://make.fun/badge/platform.svg)](https://make.fun)
[![Competition](https://make.fun/badge/c/token-radar-01.svg)](https://make.fun/c/token-radar-01)
[![Agent: Hermes](https://make.fun/badge/agent/hermes.svg)](https://make.fun)

# Token Radar — a pre-token launch radar

An entry for make.fun's **Build the best token launch radar** bounty (`token-radar-01`).

`main.ts` reads the sealed protocol snapshot, keeps every protocol that records no token and is
not a venue, a bridge or a wrapped/staked product, and ranks all of them by what their token would
be worth at launch. It writes `board.json`, the dashboard's dataset (`data.js`), copies
`dashboard/` and `screenshots/`, and writes `dossier.json` with the kit's `vendor/makefun-board.ts`.

    mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json

## The value model

    implied = round( tvl_usd x sectorMultiple x growth x maturity x 1.40 )

- **sectorMultiple** — measured, not assumed: the median market-cap-to-TVL ratio of the snapshot's
  own live-token protocols in the same category, clamped to 0.15x–3.0x. A category with fewer than
  three live peers falls back to the whole market's median.
- **growth** — `1 + clamp(change_7d, -50, 100) / 100 * 0.35`.
- **maturity** — `0.85 + 0.15 * min(age_days, 1460) / 1460`, where age is the time since the
  protocol was first listed; a longer record with no token counts for more.
- **1.40** — the one stated assumption: a token lists with a small float, so its fully diluted
  value runs above the multiple its liquid peers trade at.

No protocol name is special-cased and no row is hand-picked. Each of the 197 rows carries six farm
steps with a cost and a time, derived from the protocol's category, chains, TVL tier and age.

## Layout

    main.ts                    the program (Node 22, standard library only)
    lib/model.ts               the value model, the board, the farm plans, the gate guard
    vendor/makefun-board.ts    the kit's dossier library (byte for byte)
    dashboard/                 index.html, app.css, app.js — static, no network
    screenshots/               the board, a detail view, a filtered view (1440x900)

MIT licensed.
