# checkout-reservations design review

`docs/design.md` is the design up for review. The checkout service today handles about 40 orders a second at peak
and runs on 6 nodes in one region; the payment provider times out on about 1 in 500 calls.
