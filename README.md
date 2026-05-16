# wangap-archive

Long-term static archive of [Wang'ap](https://www.wangap.fr/) — the
sailing logbook of Catherine & Bertrand's Outremer 52 voyage.

**Latest snapshot**: 2026-05-16T11:58:32.030Z
**Contents**: 40 posts · 22 photos · 14 étapes · 7 chapters

A GitHub Action in [sailingwangap/jdb_wangap](https://github.com/sailingwangap/jdb_wangap)
generates this archive every Monday at 03:00 UTC. Each commit is an immutable
point-in-time copy. The latest snapshot is served at:

- [sailingwangap.github.io/wangap-archive/](https://sailingwangap.github.io/wangap-archive/) — always works (GitHub Pages default)
- [archive.wangap.fr](https://archive.wangap.fr/) — intended canonical URL, pending Godaddy DNS CNAME. Once set, GitHub auto-redirects the github.io URL to the custom domain.

Past snapshots remain accessible through git history. Each snapshot includes
a machine-readable [`snapshot-meta.json`](./snapshot-meta.json) with the
exact timestamp, record counts, and workflow run URL.

## Don't edit by hand

Every snapshot regenerates from current Supabase state. Manual commits to `main`
will be overwritten on the next cron run. To change content, edit
[wangap.fr](https://www.wangap.fr/) — the next snapshot will pick it up.

## Architecture

See [ADR-0002](https://github.com/sailingwangap/jdb_wangap/blob/main/docs/decisions/0002-archive-wangap-fr.md)
in the main app repo for design decisions (renderer, hosting, photo strategy,
privacy model).
