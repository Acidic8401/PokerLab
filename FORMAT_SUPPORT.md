# Confirmed format observations

## 888poker

Samples were inspected from the user-selected 888poker HandHistory folder. The inspected text is unmodified UTF-8/ASCII-compatible text with CRLF line endings and no byte-order mark. No raw personal hand histories were copied into the repository. Fixtures use the observed structure with player names redacted consistently within each hand.

An audit of 11 non-summary files found 131 hand blocks. All 131 blocks parsed; 128 had no parser warnings and three had no dealt-to hero cards, which are retained as partial hands with warnings.

Observed tournament and BLAST hand blocks use `#Game No : <id>` as a boundary. The following lines identify the game, stakes/variant and timestamp, tournament ID, table, button seat, player count and seats. Actions name a player and use forms including `posts ante [n]`, `posts small blind [n]`, `posts big blind [n]`, `folds`, `checks`, `calls [n]`, `bets [n]`, and `raises [n]`. Board streets use `** Dealing flop/turn/river ** [ cards ]`. Summary text can include show/muck status and `First runout <player> collected [n]`.

The parser records action amounts as reported integer chip amounts. For raises, it also places that reported number in `amountTo`; it does not infer the incremental amount from the betting state. The source timestamp has no timezone marker. PokerLab retains the displayed date/time fields as a timezone-less timestamp and does not convert or assert the original timezone. A collect action is a collected pot amount, not a net hand result.

Parser version 1.1.0 also reads the tournament price pair from the hand header and the tournament title from a recognized selected filename. For a `$0.90 + $0.10` pair, it stores 90 minor units as the prize-pool contribution and 10 as the rake, with `$` retained as the source currency symbol. Position labels use the button and occupied seats in ascending seat order, wrapping around after the highest seat and skipping empty seats. This is necessary because physical seat numbers can have gaps; for example, after button seat 8 the next occupied seats may be 10 and 1. Standard labels are assigned for 2-8 occupied players. Revealed or mucked cards are stored separately from action chip amounts.

An additional selected tournament file showed 8-max hands with 7 or 8 occupied seats, the `$0.90 + $0.10` entry split, and showdown `shows`/`mucks` lines that include cards. No raw player names or hand text from that file were added to the repository.

## Explicit gaps

Only the observed No Limit Holdem hand block form is enabled. Summary companion files, cash-game variants, other games, unexpected action text, and undocumented encodings are not treated as confirmed. Unknown lines produce line diagnostics. Sky Poker is unsupported because no representative sample was found.
