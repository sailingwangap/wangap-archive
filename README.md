# wangap-archive

Long-term static archive of [Wang'ap](https://www.wangap.fr/) — the
sailing logbook of Catherine & Bertrand's Outremer 52 voyage
(2026–2029).

A GitHub Action in the main app repo
([sailingwangap/jdb_wangap](https://github.com/sailingwangap/jdb_wangap))
takes a weekly snapshot of the public site (posts, étapes, chapters,
photos, route, aggregate stats) and commits it here. Each commit is
an immutable point-in-time copy. The latest snapshot is served at
**[archive.wangap.fr](https://archive.wangap.fr/)** via GitHub Pages.

Past snapshots remain readable through git history.

## Why?

Today's Wang'ap depends on Supabase + Vercel. In 10–20 years either
could disappear. This archive decouples the *memory* of the voyage
from the *operational stack*: a public, static, immutable mirror
that can be read in 30 years even if nothing else exists. See
[ADR-0002](https://github.com/sailingwangap/jdb_wangap/blob/main/docs/decisions/0002-archive-wangap-fr.md)
for the architectural decisions.

## Don't edit this repo by hand

Every snapshot regenerates from current Supabase state. Manual
commits to `main` will be overwritten on the next Monday cron run.

— Last bootstrap: 14 May 2026.
