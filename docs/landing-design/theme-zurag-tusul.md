# Theme: «Зураг төсөл» (Drafting Sheet)

Custom theme for the E-Property landing (theme-factory, "create your own theme").
Built on the brand colours in [brand-and-landing.mn.md](../brand-and-landing.mn.md);
none of the ten preset themes keeps the navy + teal identity, so this one extends it.

Mood: an architect's drawing sheet. Cool drafting paper, navy ink, one teal accent,
data set in a monospace like dimensions on a plan.

## Colours

| Token | Light | Dark | Role |
|---|---|---|---|
| `--paper` | `#F3F6F9` | `#0C1522` | Page ground (brand `#F5F7FA` nudged toward navy) |
| `--sheet` | `#FFFFFF` | `#121E2F` | Drawing sheets, cards |
| `--ink` | `#192635` | `#DCE5EF` | Body text (brand) |
| `--navy` | `#142D4E` | `#D4E3F3` | Headings, primary action (brand) |
| `--teal` | `#087F8C` | `#4CC3CF` | Links, accent (brand) |
| `--muted` | `#556375` | `#93A3B6` | Secondary text |
| `--rule` | `#D5DEE7` | `#22324A` | Hairlines, grid |

### Sales status (validated with the dataviz `validate_palette.js`)

| Status | Light | Dark | Secondary encoding |
|---|---|---|---|
| Сул (available) | `#00939F` | `#1A9AA8` | solid fill + label |
| Захиалгатай (reserved) | `#B97400` | `#C4862A` | 45° stripes + label |
| Зарагдсан (sold) | `#8296B0` | `#6A7FA4` | fine cross hatch + label |

Light: lightness band, CVD separation (worst ΔE 16.3), normal-vision floor and
3:1 contrast all PASS. Dark: all PASS except the chroma floor for "sold".
"Sold" is deliberately low-chroma: it is the recessive state (no longer for sale),
and it is never identified by colour alone — it carries a hatch texture and a text label.

## Type

| Role | Face | Why |
|---|---|---|
| Display | Geologica 600–800 | Cyrillic-first grotesque; sharp, architectural |
| Body | Golos Text 400–600 | Built for public-service Cyrillic text; very readable |
| Data | IBM Plex Mono 400–600 | Unit IDs, m², dates, prices — dimensions on a drawing |

All three were checked in a browser for Mongolian `Ө ө Ү ү` glyphs (Unbounded and
others that fall back for those letters were rejected).
