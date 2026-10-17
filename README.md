# PokerLab

PokerLab is a local-first post-session tournament hand study app. The current MVP supports importing, browsing, searching, and replaying 888poker tournament and BLAST hand histories, with card graphics in the hand list and replay view. Sky Poker remains explicitly unsupported.

## Run locally

Requires Node.js 20.19 or newer. Run `npm install`, then `npm run dev` for browser development. The desktop app uses Tauri 2, Rust, the Windows C++ Build Tools, and WebView2. Run `npm run desktop:dev` to launch it in development or `npm run desktop:build` to create Windows installers. Tauri stores hand records in `pokerlab.db` under the app data directory. Browser development continues to use IndexedDB under `pokerlab-local`.

## Import support

- **888poker tournament and BLAST:** parser version 1.1.0, based on observed hand-history structures. CRLF text files with `#Game No` hand boundaries, 888poker hand headers, blind/date lines, tournament ID, seats, actions, and summary lines are supported. When the selected filename follows the observed tournament naming pattern, the parser also extracts the tournament title and the prize-pool contribution/rake split. Seat positions are derived from the button and the clockwise order of occupied seats, skipping empty seat numbers. Shown/mucked cards are stored separately from chip amounts.
- **Sky Poker:** unsupported. No sample was available to confirm its format.

Redacted structural fixtures for the confirmed 888poker variants are in `fixtures/888poker/`. Player names have been replaced while keeping the file structure intact. Unknown lines create warnings and retain their source hand text; malformed blocks are reported and skipped. Re-imports are idempotent by site plus source hand ID.

The parser stores raw source text per successfully parsed hand for traceability. Buy-in and rake amounts are stored in minor currency units (for example, 90 and 10 cents) with the source currency symbol; the first amount is the prize-pool contribution and the second is the rake. Amounts are retained as integer chips exactly as printed in action lines. A `raise` keeps the reported value in both `amount` and `amountTo`; calls/bets/blinds/antes keep the reported value in `amount`. The parser does not infer pot size, chip delta, or net tournament result. A collected pot is displayed as chips collected, not as net winnings. Dates have no explicit timezone in these files, so PokerLab stores and displays the source date/time fields without assigning a timezone.

## Local data and privacy

The app reads only files selected or dropped by the user. Desktop hand records are stored in a SQLite database in the app data directory; browser development uses the current browser profile's IndexedDB. No accounts, telemetry, remote uploads, external fonts, or poker-client interaction are implemented. Settings provides deletion of stored hand records. A user's right to use/import operator-provided histories depends on the applicable operator terms and local law; PokerLab does not determine that permission.

## Limitations

The first desktop shell and SQLite storage path are scaffolded; a Windows native build still requires the Rust toolchain and Windows build prerequisites on the build machine. Tournament summaries, net chips, outcome rates, tags, pagination, and Sky Poker parsing are not implemented. Position labels are derived from the occupied seat order and button; unfamiliar table sizes remain unlabeled. Replay shows parsed actions and table data, but does not derive live pot sizes or claim strategic quality. See [FORMAT_SUPPORT.md](FORMAT_SUPPORT.md) for observed source details.
