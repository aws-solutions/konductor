# Branch notes: feat/wallet-withdraw

- Adds POST /wallets/withdraw and GET /wallets/:id/balance.
- Withdrawals are converted with the live FX rate before debiting.
- Previously we only supported USD wallets; now any currency works via the rate service.
- Found during review round 2 that the rate lookup was called twice, fixed it so it's called once.
- Updated per feedback from Priya: renamed getFx to getRate.
- To test: npm test, then curl -XPOST localhost:3000/wallets/withdraw -d '{"walletId":"w1","amount":10,"currency":"EUR"}'
