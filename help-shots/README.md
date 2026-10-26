# Help guide screenshots

These fill the numbered placeholders in `public/guide.html`.

- **Filename = zero-padded shot number + `.webp`**: `01.webp`, `02.webp`, … `30.webp`.
- Stored as WebP (resized to max 1280px wide, quality 85) — the 30 shots total ~1.4 MB.
- As soon as a file exists, the dashed placeholder box in the guide is replaced by the image automatically (no code change needed).

## Adding / replacing a shot

Capture as PNG, then convert (requires `cwebp`):

```sh
cwebp -q 85 -resize 1280 0 "new-shot.png" -o NN.webp   # use -resize only if wider than ~1280px
```

The whole folder was generated from PNG captures with this loop:

```sh
for f in [0-9][0-9].png; do n="${f%.png}"
  w=$(sips -g pixelWidth "$f" | awk '/pixelWidth/{print $2}')
  [ "$w" -gt 1280 ] && cwebp -q 85 -resize 1280 0 "$f" -o "$n.webp" || cwebp -q 85 "$f" -o "$n.webp"
done
```

## Shot list (30)

### 🌍 Public
1. Home page — hero + intro + posts + stats + map preview
2. "Le projet" page with the 18-phase route table (+ Genèse)
3. The Programme — the 18 voyage phases
4. The Animation — sailboat travelling the planned route
5. Public interactive map (track + posts + planned route)
6. Newsletter subscribe form + public archive (/newsletters)
7. Comment box + "Message the skippers" contact form
8. Guest Book contribution page (via invite link)

### ❤️ Family
9. Login screen
10. Family dashboard (live position + latest news)
11. Timeline with the filter row
12. Open post + photo lightbox + logbook blocks
13. FR/EN language toggle (bilingual content)
14. Stats page with charts and KPIs
15. Messages thread (list + detail)
16. Guest Book album
17. Settings menu in drill mode

### ⛵ Skipper
18. Post composer with the logbook blocks (Nav/Conditions/Tech)
19. Map in track-edit mode (selectable waypoints)
20. Marks / POI layer on the map
21. Chapters & legs settings + visibility toggle
22. Manual position + public visibility settings
23. AIS config panel + status + DB feed
24. Maintenance log + stats
25. To-do list with priorities and due dates
26. Le Renard chat with the Sources bar
27. Knowledge base administration (/renard/admin)
28. Section-based newsletter composer
29. Guest Book moderation queue + crew invites
30. Backup/archive + access management + technical maintenance

The captions are also stored as the `cap` field on each card in `public/guide.html`.
