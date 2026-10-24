# Bundled piece sets

Every folder here is mirrored to `app/public/pieces/<set>/` so the same 12 SVGs
are served by both the Express static mount (`/pieces`) and the Vite build.
Each set contains all twelve files:

```
wK.svg wQ.svg wR.svg wB.svg wN.svg wP.svg
bK.svg bQ.svg bR.svg bB.svg bN.svg bP.svg
```

The default set is `chessbook_monochrome` (the set the reference account uses).
The alternative sets below were downloaded from the Lichess piece asset CDN
(`https://lichess1.org/assets/piece/<set>/<piece>.svg`), which serves the
open-source sets in the [lila repository](https://github.com/lichess-org/lila/tree/master/public/piece).
Licence and author information was checked against
[`COPYING.md` in lila](https://github.com/lichess-org/lila/blob/master/COPYING.md)
on 24 Oct 2026.

| Folder | Name | Author | Licence |
|---|---|---|---|
| `chessbook_monochrome` | Chessbook Monochrome | bundled with this local build | project assets |
| `cburnett` | Cburnett | [Colin M.L. Burnett](https://en.wikipedia.org/wiki/User:Cburnett) | [GPLv2+](https://www.gnu.org/licenses/gpl-2.0.txt) |
| `merida` | Merida | Armando Hernandez Marroquin | [GPLv2+](https://www.gnu.org/licenses/gpl-2.0.txt) |
| `chessnut` | Chessnut | [Alexis Luengas](https://github.com/LexLuengas/chessnut-pieces) | [Apache 2.0](https://github.com/LexLuengas/chessnut-pieces/blob/master/LICENSE.txt) |
| `shapes` | Shapes | [flugsio](https://github.com/flugsio/chess_shapes) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |

Notes:

- The Lichess page lists `alpha` (Eric Bentzen) as “free for personal
  non-commercial use” and `chess7` (Style-7) as “freeware”. Because neither is a
  clear open-source/CC licence, they are not bundled. The two permissive
  alternatives above (`chessnut`, `shapes`) are used instead.
- GPLv2+ and CC BY-SA 4.0 require attribution and share-alike terms for
  redistribution; the table above is the required attribution notice.
- `chessbook_monochrome` is complete (all 12 pieces) and remains the fallback for
  any unknown `pieceSet` value.

The corresponding server metadata lives in `server/settings.js` (`PIECE_SETS`),
and the client mirror is `app/src/prefs.ts` (`PIECE_SETS`).
