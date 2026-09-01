# Attributions

## gods-eye-view (MIT)

The LIVE feed substrate (celestrak TLE + SGP4 satellite layer, USGS
seismic layer, and the keyless-feed proxy posture) is adapted from
**gods-eye-view** by Bilawal Sidhu — https://github.com/bilawalsidhu/gods-eye-view
(fork: notationsystems/gods-eye-view), MIT License, Copyright (c) 2026
Bilawal Sidhu. Adapted, not vendored: the feed catalog, SGP4+GMST
propagation discipline, constellation taxonomy, and cache/proxy posture
were re-implemented against PayLoad OS's own renderer, envelope, and
honesty rules (computed positions labeled with basis + TLE age; typed
refusals; stale-with-stated-age caching).

## satellite.js (MIT)

SGP4/SDP4 propagation via https://github.com/shashwatak/satellite-js.

## kepler.gl (MIT)

Interaction patterns (hover tooltip, arc brushing, legend, time-density
strip) studied and adapted from https://github.com/keplergl/kepler.gl —
patterns only, no code vendored.

## Natural Earth / world-atlas

Country and land geometry via world-atlas (Natural Earth data, public
domain).
