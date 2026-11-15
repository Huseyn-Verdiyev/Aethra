# Aethra

Aethra is a lunar south-pole site screening interface for the NASA Space Apps challenge. Its terrain horizon profiles are derived from NASA Lunar Orbiter Laser Altimeter (LOLA) digital elevation models (DEMs). Scores, illumination windows and subsystem outputs are estimates from this project; they are not NASA ratings, validated mission predictions, or landing recommendations.

## Terrain inputs

- The regional terrain source is NASA GSFC PGDA's `LDEM_80S_80MPP_ADJ.TIF` (80 m/pixel), from the South Pole LOLA product. Product page: <https://pgda.gsfc.nasa.gov/products/90>. Data DOI: `10.60903/gsfcpgda-lola-spole`; paper DOI: `10.3847/PSJ/acf3e1`.
- Where available, 5 m/pixel local LOLA DEMs refine the near horizon for Site01 / Connecting Ridge, Site06 / Nobile Rim 1, Site23 / Malapert Massif and Haworth. NASA describes the products and their uncertainty/coverage limits at <https://pgda.gsfc.nasa.gov/products/78>.
- The five site reference-center coordinates are from NASA's 2025 *Lunar Surface Data Book*, Table A2.1-1. The book says these centers are from polygons generated from the PGDA LOLA DEMs and accurate to about 5–10 m. de Gerlache Rim 2 has no matching local 5 m raster in the chosen set, so its profile uses the global 80 m DEM only.

## Rebuild the terrain profiles

Install Python 3 with `numpy`, `tifffile`, and `imagecodecs`. Download the DEMs from the NASA PGDA pages above, then run from the repository root:

```sh
python3 scripts/derive_lola_profiles.py \
  --global-dem /path/to/LDEM_80S_80MPP_ADJ.TIF \
  --site01 /path/to/Site01_final_adj_5mpp_surf.tif \
  --site06 /path/to/Site06_final_adj_5mpp_surf.tif \
  --site23 /path/to/Site23_final_adj_5mpp_surf.tif \
  --haworth /path/to/Haworth_final_adj_5mpp_surf.tif \
  --out src/lolaHorizonProfiles.json
```

The local DEM options are optional. Without one, that site is computed from the 80 m regional grid. The script records its method, data identifiers, coordinate centers, and known limitations in the JSON's `_meta` field.

For each site, the script samples 360 bearings at one-degree intervals along spherical great-circle rays. It samples the regional grid out to 140 km and each supplied local grid out to 25 km, bilinearly interpolates the DEM, and computes apparent terrain elevation from Moon-center geometry. Where a 5 m profile exists, the greater of the local and regional horizon angles is retained per bearing. Heights in the interface are rounded to 10 m; the unrounded DEM sample is retained in the JSON.

## Cross-resolution check

At the four centers with local data, global 80 m vs. local 5 m horizon differences over the first 5 km had mean absolute differences of 0.82° (Connecting Ridge), 0.35° (Nobile), 1.50° (Malapert), and 0.43° (Haworth); the largest 95th-percentile difference was 3.52° at Malapert. This is a resolution comparison, not a ground-truth accuracy result. It shows why the 80 m-only profile should be treated as regional context and why even a 5 m LOLA DEM does not certify landing hazards. NASA reports that about 90% of pixels in these polar 5 m DEMs are interpolated, alongside nonzero height and slope uncertainty.

## Other model limits

The application uses the Astronomy Engine library for analytical ephemeris calculations; it does not use JPL DE440/DE441. Its horizon rays use a 1737.4 km spherical reference radius to match the LOLA terrain model. The per-site terrain ratings used for the 10% score term are hand-entered project inputs; they are not calculated from a common-resolution slope layer. Solar/battery/thermal/radio hardware values, score weights and the battery cutoff are also project assumptions, even where NASA material informs the calculation structure. The score therefore combines data-derived terrain visibility with assumptions and should only be used to compare this model's scenarios.

## References

- NASA Space Apps challenge: <https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/>
- NASA GSFC PGDA, South Pole LOLA DEM: <https://pgda.gsfc.nasa.gov/products/90>
- NASA GSFC PGDA, High-Resolution LOLA Topography for Lunar South Pole Sites: <https://pgda.gsfc.nasa.gov/products/78>
- NASA, *Lunar Surface Data Book*, NASA/TP-20250002845 (2025), Table A2.1-1: <https://ntrs.nasa.gov/api/citations/20250002845/downloads/M2M-30044%20Lunar%20Surface%20Data%20Book%20Baseline_Final.pdf>
- Astronomy Engine: <https://github.com/cosinekitty/astronomy>
