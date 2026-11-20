"""Central registry of every public dataset the pipeline consumes.

All sources are official MBTA / MassDOT open data:
  * MBTA Open Data Portal (ArcGIS Hub): https://mbta-massdot.opendata.arcgis.com
  * MBTA V3 API: https://api-v3.mbta.com
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
RAW = DATA / "raw"
WAREHOUSE = DATA / "warehouse.duckdb"
SITE_DATA = ROOT / "site" / "data"
REPORTS = ROOT / "reports"

ARCGIS_ITEM = "https://www.arcgis.com/sharing/rest/content/items/{item_id}"
FEATURE_BASE = "https://services1.arcgis.com/ceiitspzDAHrdGO1/arcgis/rest/services"
V3_API = "https://api-v3.mbta.com"


@dataclass(frozen=True)
class HubFile:
    """A file (CSV or zipped CSV collection) hosted on the MBTA open-data hub."""

    key: str
    item_id: str
    filename: str
    title: str

    @property
    def url(self) -> str:
        return ARCGIS_ITEM.format(item_id=self.item_id) + "/data"

    @property
    def portal_url(self) -> str:
        return f"https://mbta-massdot.opendata.arcgis.com/datasets/{self.item_id}"


@dataclass(frozen=True)
class FeatureLayer:
    """An ArcGIS Feature Service layer, paged through the REST query endpoint."""

    key: str
    item_id: str
    service: str
    title: str
    layer: int = 0

    @property
    def query_url(self) -> str:
        return f"{FEATURE_BASE}/{self.service}/FeatureServer/{self.layer}/query"

    @property
    def portal_url(self) -> str:
        return f"https://mbta-massdot.opendata.arcgis.com/datasets/{self.item_id}"


HUB_FILES: tuple[HubFile, ...] = (
    HubFile("bus_reliability", "9dfc9a9945d84b9c8aa7d7973bb08001", "bus_reliability.csv",
            "MBTA Bus Reliability"),
    HubFile("cr_reliability", "ec18161c237d419698abc767f1be6a50", "cr_reliability.csv",
            "MBTA Commuter Rail Reliability"),
    HubFile("speed_restrictions", "83b729560080401e903345f1058b5cc8", "speed_restrictions.zip",
            "MBTA Rapid Transit Speed Restrictions by Day"),
    HubFile("prediction_accuracy", "155ab68df00145cabddfb90377201b0e", "prediction_accuracy.csv",
            "Rapid Transit and Bus Prediction Accuracy Data"),
    HubFile("customer_satisfaction", "a15bbd44359840fa95423052980dc89d",
            "customer_satisfaction.csv", "MBTA Service Customer Satisfaction"),
    HubFile("alerts_2025", "ef115f7cf6684360b040b6d1d033eff0", "alerts_2025.zip",
            "MBTA Service Alerts 2025"),
    HubFile("excess_trip_time", "031c3392b4fd46baad54fcceb9fb4254", "excess_trip_time.csv",
            "MBTA Heavy Rail Excess Trip Time"),
    HubFile("cr_ridership_by_line", "59b5c61e8e9f42f9a3745f7ad63d07d6",
            "cr_ridership_by_line.csv", "MBTA Commuter Rail Ridership by Service Date and Line"),
    HubFile("gse_historical", "7859894afb5641ce91a2bb03599fdf5b", "gse_by_year.zip",
            "MBTA Gated Station Entries - Historical"),
    HubFile("comfort", "f669fc7a9b1c49b292532b1b7b936e97", "sdp_comfort.csv",
            "MBTA Service Delivery Policy Comfort Metric"),
)

FEATURE_LAYERS: tuple[FeatureLayer, ...] = (
    FeatureLayer("monthly_ridership", "2048258a18354256a650d41f8fe4532c", "NTD_Reporting",
                 "MBTA Monthly Ridership By Mode and Line"),
    FeatureLayer("passenger_survey_2025", "2dac9c48bd3440c2bcf2a220614c667b",
                 "MBTA_2025_System-Wide_Passenger_Survey", "MBTA 2025 System-Wide Passenger Survey"),
    FeatureLayer("stop_distances", "17cca8087d11486cbff9db871053b020",
                 "MBTA_Rapid_Transit_Stop_Distances", "MBTA Rapid Transit Stop Distances"),
)

RAPID_TRANSIT_ROUTES = ("Red", "Mattapan", "Orange", "Blue",
                        "Green-B", "Green-C", "Green-D", "Green-E")

LINE_COLORS = {
    "Red Line": "#DA291C", "Orange Line": "#ED8B00", "Blue Line": "#003DA5",
    "Green Line": "#00843D", "Mattapan Line": "#DA291C", "Silver Line": "#7C878E",
    "Commuter Rail": "#80276C", "Bus": "#FFC72C", "Ferry": "#008EAA",
}
