// Station graph + fare rules exported by the pipeline (`mbta-ti analyze`).
export const net = await (await fetch(new URL("../data/network.json", import.meta.url))).json();
export const R = net.rules;
export const ST = net.graph.stations;
export const FLAT = net.flat_fare;
export const stationName = id => ST[id]?.name ?? "Unknown";
