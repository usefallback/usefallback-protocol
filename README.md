# Fallback

**Bad fall? Fall back.**

[![Live site](https://img.shields.io/badge/live-fallback.ink-yellow?style=flat-square)](https://fallback.ink)
[![Chain](https://img.shields.io/badge/chain-Solana-black?style=flat-square)](https://solana.com)
[![License: MIT](https://img.shields.io/badge/license-MIT-lightgrey?style=flat-square)](LICENSE)

| | |
|---|---|
| Chain | Solana |
| CA | _pending, not yet stated_ |
| Site | [fallback.ink](https://fallback.ink) |

## Overview

Fallback is a soft landing for collectors who open sealed boxes of cards and watches. When a reveal is worth less than it cost, a share of the shortfall comes back as USDC. This repository holds the marketing site and its live market board.

## Features

- Live board of the ten busiest Solana tokens by traded volume, refreshed every minute, paused while the tab is hidden.
- A contract line pinned to the top of the page that stays inert until an address is stated.
- A register of external facts (`src/register.json`): every fact is `stated`, `absent` or `unconfirmed`, and anything not stated renders inert.
- Motion tuned for depth (spring reveals, parallax, spotlight, count-up) with a full reduced-motion fallback.

## Links

- Site: <https://fallback.ink>
- X: _pending_
- GitHub: _pending_
- Whitepaper: [docs/whitepaper.md](docs/whitepaper.md)

## Develop

```bash
npm install
npm run build   # writes dist/ (the folder to deploy)
npm run gates   # runs every gate, exits 0 when all pass
npm run serve   # serves dist/ locally
```

## License

MIT. See [LICENSE](LICENSE).
