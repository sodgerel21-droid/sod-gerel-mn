# Algorithmic philosophy: «Кадастр» (Parcel Subdivision)

Land is never empty; it is already divided. Every plot on a cadastral map is the
residue of a decision — a line drawn, a parcel split, a boundary agreed. This
movement treats that act of division as the generative primitive. A single
rectangle of ground is cut, and cut again, by a process that always prefers the
longer side and never cuts too close to an edge, until the field settles into a
quiet mosaic of parcels that feels surveyed rather than random.

The algorithm is recursive binary subdivision under seeded randomness. Each
rectangle chooses its cut axis from its own proportions, places the cut inside a
narrow band around the golden section, and stops when its area falls below a
threshold scaled to the viewport. The seed fixes the whole map: the same seed
always yields the same district, the way a parcel register always returns the same
plot for the same number. It is a meticulously tuned system in which every
threshold was refined until the result looked like a city block and not like noise.

Time is drawn in the order a surveyor would work: the largest boundaries appear
first, finer lots follow, each line extending from its start point to its end over
a few hundred milliseconds. A small fraction of parcels — chosen by the same seed —
receive a faint fill, a hint that some ground is already built, some reserved,
most still open. The palette is limited to the sheet's own rules and a single tint
of the brand teal; nothing competes with the headline.

Restraint is part of the craft. The drawing sits behind the hero at low contrast,
fades toward the text column so reading is never disturbed, stops completely once
drawn, and renders its final frame immediately for anyone who prefers reduced
motion. It is the product of painstaking calibration: line weight of one device
pixel, cut band, minimum parcel size and density all balanced so that the field
reads as texture at a glance and as a map on a second look.

Implementation: `landing/index.html`, function `drawCadastre()` — vanilla Canvas 2D
(no p5.js dependency on the production page), seeded mulberry32 PRNG.
