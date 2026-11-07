# Portfolio Dashboard

A one-glance, static web dashboard for tracking RBC Direct Investing accounts **without** connecting to RBC.
Each account (and a combined "All accounts" view) shows its value and change in **$ or %** over
**1D / 1W / 1M / 3M / 6M / YTD / 1Y / 3Y / since cost**, with a chart, a holdings table, and a privacy blur.

## How it works (and why it's safe to host publicly)

| Piece | Where it lives |
|---|---|
| The website (`index.html`, `app.js`, `core.js`, `style.css`) | this repo → GitHub Pages |
| **Prices** (Yahoo Finance) | downloaded by a GitHub Action every ~30 min on market days → `data/prices.json` on the site |
| **Your holdings** (accounts, quantities, book cost) | **only in your browser** (localStorage). They are never committed to this repo or sent to any server. |

Because holdings aren't in the repo, the repo and site can be public (required for free GitHub Pages) without exposing your accounts.
The price list in `symbols.txt` only contains ticker symbols.

## Updating after you trade

1. In RBC Direct Investing, export each account's **Holdings** as CSV (you already did this once).
2. Open the dashboard → **Manage → Import CSV files** (or just drag the CSVs onto the page).
   An account with the same number is *replaced* with the new holdings; new account numbers are added.
3. Or make a quick manual edit: **Manage → Edit** to change a quantity / book cost / add a holding.

If you buy something that isn't in `symbols.txt` yet, the dashboard shows a banner. Add its Yahoo symbol to
[`symbols.txt`](symbols.txt) (Canadian listings end in `.TO`, e.g. RBC `XEQT` → `XEQT.TO`; US listings have no suffix)
— commit it and the next run picks it up. Until then it uses the last RBC price and shows no history.

## Using it on your phone

Holdings live in one browser, so to use another device: **Manage → Copy private link**, then open that link on the other device.
Your holdings travel in the URL *fragment* (after `#`), which browsers never send to servers. Treat the link like a password.
**Manage → Download backup** saves the same data as a JSON file.

## How the numbers are calculated

* Price-only change (distributions are not included), using each ETF's price history from Yahoo Finance.
* Period change = **today's positions** valued at today's price vs. at the start of the period. It is *not* your personal
  time-weighted return, and it ignores trades/withdrawals made during the period.
* "Since cost" compares current value to the RBC book cost in your export.
* GICs accrue at their stated coupon rate from the statement date (to maturity); savings accounts / mutual funds without a
  price feed (e.g. RBC Investment Savings) are held flat at the exported value; cash is flat.
* USD holdings are converted with the USD→CAD rate (`USDCAD=X`).
* Thinly traded ETFs can show a slightly different "last price" than RBC.

## Develop / preview locally (Windows, no installs needed)

```powershell
powershell -ExecutionPolicy Bypass -File scripts/fetch-prices.ps1   # writes data/prices.json
powershell -ExecutionPolicy Bypass -File scripts/serve.ps1          # open http://localhost:8080
```

Logic tests: open `http://localhost:8080/tests/index.html` — every line should say PASS.

## Hosting setup (one time)

1. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Run **Actions → Update prices and deploy → Run workflow** (it also runs on every push and on the market-hours schedule).

Note: GitHub pauses scheduled workflows in a repo with no activity for 60 days — re-enable from the Actions tab if that happens.

Not investment advice; prices may be delayed or inaccurate. Check RBC for official balances.
