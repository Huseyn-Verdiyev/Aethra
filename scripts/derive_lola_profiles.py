#!/usr/bin/env python3
"""Rebuild src/lolaHorizonProfiles.json from NASA GSFC PGDA LOLA GeoTIFFs.

Requires Python 3, numpy, tifffile and imagecodecs. The global raster is the
80 m/pixel South Pole DEM. Local rasters are the 5 m/pixel Site01, Site06,
Site23 and Haworth products. Missing local rasters are allowed; that site's
profile will then use only the global DEM.
"""
import argparse
import json
import math
from pathlib import Path

import numpy as np
import tifffile

MOON_RADIUS_M = 1_737_400.0
GLOBAL_ORIGIN = (-304_000.0, 304_000.0)  # upper-left pixel corner, meters
GLOBAL_RESOLUTION_M = 80.0
GLOBAL_RANGE_M = 140_000.0
LOCAL_RANGE_M = 25_000.0

SITES = {
    "shackleton": {"lat": -89.4632, "lon": -137.49, "center": "R01 / Site01 Connecting Ridge"},
    "nobile": {"lat": -85.4381, "lon": 37.36667, "center": "R06 / Site06 Nobile Rim 1"},
    "malapert": {"lat": -85.9948, "lon": -0.23578, "center": "R23 / Site23 Malapert Massif"},
    "haworth": {"lat": -86.7639, "lon": -22.777, "center": "Haworth"},
    "de_gerlache": {"lat": -88.23, "lon": -64.6284, "center": "SL2 de Gerlache Rim 2"},
}


def stereographic_xy(lat_deg, lon_deg):
    rho = 2 * MOON_RADIUS_M * math.tan(math.radians(90 + lat_deg) / 2)
    return rho * math.sin(math.radians(lon_deg)), rho * math.cos(math.radians(lon_deg))


def bilinear(array, xmin, ymax, resolution, x, y):
    col = (x - xmin) / resolution - 0.5
    row = (ymax - y) / resolution - 0.5
    j0 = np.floor(col).astype(np.int64)
    i0 = np.floor(row).astype(np.int64)
    fx, fy = col - j0, row - i0
    valid = (i0 >= 0) & (j0 >= 0) & (i0 + 1 < array.shape[0]) & (j0 + 1 < array.shape[1])
    out = np.full(np.shape(col), np.nan, dtype=np.float64)
    if np.ndim(col) == 0:
        if bool(valid):
            q = (array[i0, j0], array[i0, j0 + 1], array[i0 + 1, j0], array[i0 + 1, j0 + 1])
            if np.all(np.isfinite(q)):
                out = float((1 - fy) * ((1 - fx) * q[0] + fx * q[1]) + fy * ((1 - fx) * q[2] + fx * q[3]))
        return out
    indices = np.flatnonzero(valid)
    if not indices.size:
        return out
    ii, jj = i0[valid], j0[valid]
    q00, q10 = array[ii, jj], array[ii, jj + 1]
    q01, q11 = array[ii + 1, jj], array[ii + 1, jj + 1]
    finite = np.isfinite(q00) & np.isfinite(q10) & np.isfinite(q01) & np.isfinite(q11)
    values = (1 - fy[valid]) * ((1 - fx[valid]) * q00 + fx[valid] * q10) + fy[valid] * ((1 - fx[valid]) * q01 + fx[valid] * q11)
    out[indices[finite]] = values[finite]
    return out


def local_dem_metadata(path):
    with tifffile.TiffFile(path) as tif:
        page = tif.pages[0]
        scale = float(page.tags["ModelPixelScaleTag"].value[0])
        tie = page.tags["ModelTiepointTag"].value
        # NASA product tiepoints align with the raster grid; the interpolation
        # routine applies the half-pixel offset for PixelIsArea samples.
        xmin, ymax = float(tie[3]), float(tie[4])
        return page.asarray(), xmin, ymax, scale


def horizon_profile(array, xmin, ymax, resolution, lat_deg, lon_deg, max_range, step):
    x0, y0 = stereographic_xy(lat_deg, lon_deg)
    site_height = float(bilinear(array, xmin, ymax, resolution, np.array(x0), np.array(y0)))
    distances = np.arange(step, max_range + step * 0.5, step)
    delta = distances / MOON_RADIUS_M
    phi1, lam1 = math.radians(lat_deg), math.radians(lon_deg)
    profile = []
    for azimuth in range(360):
        bearing = math.radians(azimuth)
        phi2 = np.arcsin(np.sin(phi1) * np.cos(delta) + np.cos(phi1) * np.sin(delta) * math.cos(bearing))
        lam2 = lam1 + np.arctan2(np.sin(bearing) * np.sin(delta) * np.cos(phi1), np.cos(delta) - np.sin(phi1) * np.sin(phi2))
        lat2, lon2 = np.rad2deg(phi2), np.rad2deg(lam2)
        rho = 2 * MOON_RADIUS_M * np.tan(np.deg2rad(90 + lat2) / 2)
        x, y = rho * np.sin(np.deg2rad(lon2)), rho * np.cos(np.deg2rad(lon2))
        terrain = bilinear(array, xmin, ymax, resolution, x, y)
        horizontal = (MOON_RADIUS_M + terrain) * np.sin(delta)
        vertical = (MOON_RADIUS_M + terrain) * np.cos(delta) - (MOON_RADIUS_M + site_height)
        angle = np.rad2deg(np.arctan2(vertical, horizontal))
        finite = np.isfinite(angle)
        profile.append(float(np.max(angle[finite])) if finite.any() else -90.0)
    return np.asarray(profile), site_height


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--global-dem", required=True, type=Path, help="LDEM_80S_80MPP_ADJ.TIF")
    parser.add_argument("--site01", type=Path, help="5 m Site01 Connecting Ridge DEM")
    parser.add_argument("--site06", type=Path, help="5 m Site06 Nobile Rim 1 DEM")
    parser.add_argument("--site23", type=Path, help="5 m Site23 Malapert Massif DEM")
    parser.add_argument("--haworth", type=Path, help="5 m Haworth DEM")
    parser.add_argument("--out", type=Path, default=Path("src/lolaHorizonProfiles.json"))
    args = parser.parse_args()

    local_files = {"shackleton": args.site01, "nobile": args.site06, "malapert": args.site23, "haworth": args.haworth}
    global_dem = tifffile.imread(args.global_dem)
    profiles = {}
    resolution_checks = {}
    for site_id, site in SITES.items():
        global_profile, global_height = horizon_profile(global_dem, *GLOBAL_ORIGIN, GLOBAL_RESOLUTION_M,
            site["lat"], site["lon"], GLOBAL_RANGE_M, GLOBAL_RESOLUTION_M)
        path = local_files.get(site_id)
        if path:
            local_dem, xmin, ymax, resolution = local_dem_metadata(path)
            local_profile, local_height = horizon_profile(local_dem, xmin, ymax, resolution,
                site["lat"], site["lon"], LOCAL_RANGE_M, resolution)
            global_check, _ = horizon_profile(global_dem, *GLOBAL_ORIGIN, GLOBAL_RESOLUTION_M,
                site["lat"], site["lon"], 5_000.0, GLOBAL_RESOLUTION_M)
            local_check, _ = horizon_profile(local_dem, xmin, ymax, resolution,
                site["lat"], site["lon"], 5_000.0, resolution)
            absolute_difference = np.abs(global_check - local_check)
            resolution_checks[site_id] = {
                "comparisonRadiusMeters": 5_000,
                "meanAbsoluteDifferenceDegrees": round(float(np.mean(absolute_difference)), 2),
                "p95AbsoluteDifferenceDegrees": round(float(np.percentile(absolute_difference, 95)), 2),
                "maxAbsoluteDifferenceDegrees": round(float(np.max(absolute_difference)), 2),
            }
            profile = np.maximum(global_profile, local_profile)
            height, local_resolution = local_height, int(resolution)
        else:
            profile, height, local_resolution = global_profile, global_height, None
        profiles[site_id] = {
            "horizonMaskDeg": [round(float(v), 2) for v in profile],
            "elevationMeters": int(round(float(height) / 10) * 10),
            "measuredElevationMeters": round(float(height), 2),
            "global80mElevationMeters": round(float(global_height), 2),
            "localResolutionMeters": local_resolution,
            "profileRangeDeg": [round(float(np.min(profile)), 2), round(float(np.max(profile)), 2)],
            "cardinalHorizonDeg": {str(i): round(float(profile[i]), 2) for i in (0, 90, 180, 270)},
        }
        print(site_id, profiles[site_id]["measuredElevationMeters"], profiles[site_id]["profileRangeDeg"])

    metadata = {
        "globalDataset": "NASA GSFC PGDA LDEM_80S_80MPP_ADJ.TIF",
        "globalDatasetUrl": "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF",
        "globalResolutionMeters": 80,
        "globalDataDoi": "10.60903/gsfcpgda-lola-spole",
        "globalPaperDoi": "10.3847/PSJ/acf3e1",
        "siteCentersSource": "NASA Lunar Surface Data Book (2025), Table A2.1-1",
        "siteCentersUrl": "https://ntrs.nasa.gov/api/citations/20250002845/downloads/M2M-30044%20Lunar%20Surface%20Data%20Book%20Baseline_Final.pdf",
        "highResolutionUrl": "https://pgda.gsfc.nasa.gov/products/78",
        "method": "360 azimuth bins at 1 degree. Bilinear DEM samples follow great-circle rays on a 1737400 m lunar sphere to 140 km in the global 80 m grid; local 5 m grids are sampled to 25 km when supplied. Apparent terrain elevation is atan2((R+z)*cos(delta)-(R+z0),(R+z)*sin(delta)). Per-bin maximum of local and global profiles is kept.",
        "limitations": "Global 80 m data is a screening terrain model, not landing hazard certification. Local 5 m DEMs cover only four reference centers; de Gerlache Rim 2 uses the global model. Illumination, power, battery, thermal and link values remain project estimates.",
        "moonRadiusMeters": MOON_RADIUS_M,
        "azimuthStepDegrees": 1,
        "globalHorizonRangeMeters": int(GLOBAL_RANGE_M),
        "localHorizonRangeMeters": int(LOCAL_RANGE_M),
        "siteCenters": {key: {"lat": value["lat"], "lon": value["lon"], "center": value["center"]} for key, value in SITES.items()},
        "crossResolutionChecks": resolution_checks,
    }
    output = {"_meta": metadata, **profiles}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(output, separators=(",", ":")) + "\n")
    print(f"Wrote {args.out}")
    for site_id, values in resolution_checks.items():
        print(site_id, "80 m vs 5 m over 5 km:", values)


if __name__ == "__main__":
    main()
