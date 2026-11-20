"""Download raw data from the MBTA open-data hub, ArcGIS feature services and the V3 API.

Design notes
------------
* Every download is idempotent: files are skipped when present unless ``force=True``.
* Feature services are paged with ``resultOffset`` and fetched concurrently; the
  service's own ``count`` is checked against the rows received so a silent
  truncation fails loudly instead of producing a quietly-wrong warehouse.
* A ``manifest.json`` records the URL, byte size, row count and fetch time of every
  artifact so any number in the report can be traced back to its source.
"""
from __future__ import annotations

import json
import logging
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path

import pandas as pd
import requests

from mbta_ti import config

log = logging.getLogger(__name__)
SESSION = requests.Session()
SESSION.headers["User-Agent"] = "mbta-transit-intelligence/1.0 (open-data research)"


_last_v3_call = [0.0]
V3_MIN_INTERVAL = 3.2  # anonymous V3 API budget is ~20 requests/minute per IP


def _get(url: str, *, params: dict | None = None, retries: int = 6, timeout: int = 120,
         stream: bool = False) -> requests.Response:
    for attempt in range(retries):
        if url.startswith(config.V3_API):
            wait = _last_v3_call[0] + V3_MIN_INTERVAL - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            _last_v3_call[0] = time.monotonic()
        try:
            r = SESSION.get(url, params=params, timeout=timeout, stream=stream)
            if r.status_code == 429 or r.status_code >= 500:
                raise requests.HTTPError(f"HTTP {r.status_code}")
            r.raise_for_status()
            return r
        except (requests.RequestException, requests.HTTPError) as exc:
            wait = 30 if "429" in str(exc) else 2 ** attempt
            log.warning("GET %s failed (%s); retry in %ss", url, exc, wait)
            time.sleep(wait)
    raise RuntimeError(f"giving up on {url}")


class Manifest:
    def __init__(self, path: Path):
        self.path = path
        self.entries: dict = json.loads(path.read_text()) if path.exists() else {}

    def record(self, key: str, **info) -> None:
        info["fetched_at"] = datetime.now(UTC).isoformat(timespec="seconds")
        self.entries[key] = info
        self.path.write_text(json.dumps(self.entries, indent=2, sort_keys=True))


def download_hub_file(src: config.HubFile, manifest: Manifest, force: bool = False) -> Path:
    dest = config.RAW / src.filename
    if not dest.exists() or force:
        log.info("downloading %s", src.title)
        r = _get(src.url, stream=True, timeout=600)
        tmp = dest.with_suffix(dest.suffix + ".part")
        with tmp.open("wb") as fh:
            for chunk in r.iter_content(1 << 20):
                fh.write(chunk)
        tmp.replace(dest)
    if dest.suffix == ".zip":
        out = dest.with_suffix("")
        out.mkdir(exist_ok=True)
        with zipfile.ZipFile(dest) as zf:
            zf.extractall(out)
    manifest.record(src.key, title=src.title, url=src.portal_url,
                    bytes=dest.stat().st_size, file=str(dest.relative_to(config.ROOT)))
    return dest


def fetch_feature_layer(layer: config.FeatureLayer, manifest: Manifest,
                        force: bool = False, workers: int = 8) -> Path:
    dest = config.RAW / f"{layer.key}.parquet"
    if dest.exists() and not force:
        return dest
    # Page size must respect the layer's own cap; services differ (1000 vs 2000).
    meta = _get(layer.query_url.rsplit("/query", 1)[0], params={"f": "json"}).json()
    page = int(meta.get("maxRecordCount", 1000))
    count = _get(layer.query_url, params={"where": "1=1", "returnCountOnly": "true",
                                          "f": "json"}).json()["count"]
    log.info("%s: %s rows", layer.title, count)

    def fetch(offset: int) -> list[dict]:
        params = {"where": "1=1", "outFields": "*", "f": "json", "orderByFields": "ObjectId",
                  "resultOffset": offset, "resultRecordCount": page,
                  "returnGeometry": "false"}
        payload = _get(layer.query_url, params=params).json()
        if "error" in payload:
            raise RuntimeError(payload["error"])
        return [f["attributes"] for f in payload["features"]]

    with ThreadPoolExecutor(workers) as pool:
        pages = list(pool.map(fetch, range(0, count, page)))
    df = pd.DataFrame([row for p in pages for row in p])
    if len(df) != count:
        raise RuntimeError(f"{layer.key}: expected {count} rows, got {len(df)}")
    df.to_parquet(dest, index=False)
    manifest.record(layer.key, title=layer.title, url=layer.portal_url, rows=len(df),
                    file=str(dest.relative_to(config.ROOT)))
    return dest


def fetch_v3_network(manifest: Manifest, force: bool = False) -> Path:
    """Rapid-transit routes, parent stations and route shapes from the MBTA V3 API."""
    dest = config.RAW / "v3_network.json"
    if dest.exists() and not force:
        return dest
    routes = _get(f"{config.V3_API}/routes", params={"filter[type]": "0,1"}).json()["data"]
    network: dict = {"routes": [], "stops": {}, "patterns": []}
    for route in routes:
        rid = route["id"]
        shapes = _get(f"{config.V3_API}/shapes", params={"filter[route]": rid}).json()["data"]
        stops = _get(f"{config.V3_API}/stops",
                     params={"filter[route]": rid}).json()["data"]
        network["routes"].append({
            "id": rid,
            "name": route["attributes"]["long_name"],
            "color": "#" + route["attributes"]["color"],
            "polylines": [s["attributes"]["polyline"] for s in shapes],
            "stop_ids": [s["id"] for s in stops],
        })
        for s in stops:
            a = s["attributes"]
            network["stops"][s["id"]] = {"name": a["name"], "lat": a["latitude"],
                                         "lon": a["longitude"]}
        # Canonical service patterns (e.g. Alewife-Ashmont, Alewife-Braintree) give the
        # ordered stop sequence of each branch, mapped from platforms to parent stations.
        pats = _get(f"{config.V3_API}/route_patterns",
                    params={"filter[route]": rid, "filter[canonical]": "true",
                            "include": "representative_trip.stops"}).json()
        parent = {x["id"]: (x["relationships"]["parent_station"]["data"] or {}).get("id", x["id"])
                  for x in pats.get("included", []) if x["type"] == "stop"}
        trips = {x["id"]: x for x in pats.get("included", []) if x["type"] == "trip"}
        for pat in pats["data"]:
            if pat["attributes"]["direction_id"] != 0:
                continue
            trip = trips.get(pat["relationships"]["representative_trip"]["data"]["id"])
            if not trip:
                continue
            seq = [parent.get(s["id"], s["id"]) for s in trip["relationships"]["stops"]["data"]]
            network["patterns"].append({"route": rid, "name": pat["attributes"]["name"],
                                        "stops": seq})
    dest.write_text(json.dumps(network))
    manifest.record("v3_network", title="MBTA V3 API routes/stops/shapes",
                    url=config.V3_API, routes=len(network["routes"]),
                    stops=len(network["stops"]), file=str(dest.relative_to(config.ROOT)))
    return dest


def run(force: bool = False) -> None:
    config.RAW.mkdir(parents=True, exist_ok=True)
    manifest = Manifest(config.RAW / "manifest.json")
    for src in config.HUB_FILES:
        download_hub_file(src, manifest, force)
    for layer in config.FEATURE_LAYERS:
        fetch_feature_layer(layer, manifest, force)
    fetch_v3_network(manifest, force)
