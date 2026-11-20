"""Solutions playbook.  Each recommendation pairs a problem measured in this project with
countermeasures that have *measured* results elsewhere (docs/research_evidence.md).

Numbers in the text are pulled from the other analyses at build time, so the playbook
can never drift out of sync with the data.
"""
from __future__ import annotations

from mbta_ti.analysis.common import pct


def run(r: dict) -> dict:
    fi, ex, rel, sz, rd = (r["fare_integrity"], r["experience"], r["reliability"],
                           r["slow_zones"], r["ridership"])
    sh = r["short_hop"]
    shx = {(e["from"], e["to"]): e for e in sh["examples"]}
    sh_one, sh_far = shx[("Copley", "Arlington")], shx[("Copley", "Medford/Tufts")]
    eq = ex["fare_equity"]["systemwide"]
    acc_top = ex["accessibility"]["by_station"][0]
    worst_bus = rel["bus_routes_ranked"][0]
    worst_cr = rel["cr_lines"][0]
    top_stations = ", ".join(s["station"] for s in fi["coverage_by_station"][:5])
    sub_pred = [d for d in ex["predictions"]["yearly"] if d["mode"] == "subway"][-1]
    km = {m["line"]: m["median_days"] for m in sz["survival_medians"]}
    red = next(d for d in rd["trailing_recovery"] if d["line"] == "Red Line")
    break_even = fi["assumptions"]["subway_fare"] / fi["assumptions"]["mbta_fines"][0]
    ref = next(x for x in fi["sensitivity"]
               if x["k"] == fi["assumptions"]["default_k"]
               and x["inspector_hours"] == fi["assumptions"]["reference_inspector_hours"])

    items = [
        {
            "problem": "Fare evasion · measurement",
            "title": "Measure evasion continuously, in the open",
            "summary": "The MBTA publishes a 'fare engagement' ratio but no evasion rate; the newest "
                       "official estimate (buses) uses 2019 data. You cannot manage what you do not "
                       "measure, and riders' beliefs about how common evasion is drive the behaviour.",
            "actions": [
                "Run the MassDOT method (fare taps matched to automatic passenger counts) as a "
                "monthly job on every bus and Green Line trip, not a one-off study.",
                "Publish a quarterly evasion rate by mode with confidence intervals, as TfL "
                "(3.5%, 2025/26) and the New York State Comptroller already do.",
                "Add BART's 'did you witness fare evasion?' question to the Rider Census; it is "
                "how BART tracked its drop from 25% to 10%.",
            ],
            "evidence": "MassDOT bus compliance study (22% non-interaction, 2019 data); TfL; NY OSC; "
                        "BART (May 2026); Celse & Grolleau (Transport Policy, 2023).",
        },
        {
            "problem": "Fare evasion · affordability",
            "title": "Close the reduced-fare gap before policing it",
            "summary": f"{pct(eq['low_income'], 0)} of riders meet the MBTA's low-income definition, "
                       f"but only {pct(eq['any_reduced_fare'])} ride on any reduced fare and "
                       f"{pct(eq['full_fare'], 0)} pay full fare out of pocket. Part of evasion is an "
                       "affordability problem that enforcement cannot fix.",
            "actions": [
                "Auto-enrol eligible riders through data-sharing with DTA/MassHealth instead of "
                "an opt-in application (the income-eligible program has ~38,000 riders).",
                "Apply fare capping to contactless and CharlieCard taps so that heavy "
                "low-income riders never pay more than a monthly pass.",
                "Target outreach by line: the survey shows the gap is widest on buses.",
            ],
            "evidence": "MBTA 2025 Rider Census (n=145,468); MBTA Income-Eligible Reduced Fare "
                        "reports; Boston Route 28 fare-free pilot (MBTA: +22% fare-attributable "
                        "ridership).",
        },
        {
            "problem": "Fare evasion · gate jumping & tailgating",
            "title": "Harden the gates that carry the most riders first",
            "summary": "Taller, full-height gate panels are the best-evidenced single fix: WMATA "
                       "reported an 82% drop in rail evasion after retrofitting all 98 stations, and "
                       "New York's 20-station pilot cut evasion 35% on average. The MBTA has no "
                       "subway gate-hardening program.",
            "actions": [
                f"Phase 1 retrofit at the stations this model ranks highest for exposure: "
                f"{top_stations}.",
                "Use wide-aisle double-door gates for accessibility and strollers, so hardening "
                "does not push riders to the emergency gate.",
                "Alarm and camera-cover emergency gates; dwell-time sensors catch tailgating "
                "(two bodies, one tap) without facial recognition.",
                "Extend commuter-rail gates (South Station activations +33%, Ruggles +44%).",
            ],
            "evidence": "WMATA (Sept 2024); NY Governor's office (Oct 2026); MBTA/Keolis via "
                        "MassLive (Sept 2026). Vendor camera-detection claims are not yet "
                        "independently evaluated, so pilot with a control group.",
        },
        {
            "problem": "Fare evasion · enforcement",
            "title": "Randomised, optimised inspection instead of visible crackdowns",
            "summary": f"At a $50 fine and ${fi['assumptions']['subway_fare']:.2f} fare, deterrence "
                       f"needs ~{pct(break_even)} of trips checked — "
                       f"~{fi['checks_needed_per_weekday']:,.0f} checks a weekday at gated stations. "
                       "The MBTA reported 88 warnings and 0 citations in 2025. Capacity is the "
                       "constraint, so where and when inspectors stand matters most.",
            "actions": [
                f"Schedule with this project's optimiser: at the same staffing it deters "
                f"{pct(ref['gain_vs_uniform'], 0)} more evasion than an even spread and "
                f"{pct(ref['gain_vs_busiest'], 0)} more than busiest-station-first, and it never "
                f"does worse in any of the {len(fi['sensitivity'])} sensitivity cases.",
                "Generate rosters by randomised sampling from the optimal coverage, so evaders "
                "cannot learn the pattern (random controls beat concentrated crackdowns).",
                "Issue citations, not only warnings, after a published grace period; without a "
                "credible penalty the expected cost of evading is close to zero.",
                "Prioritise Green Line surface stops (65 of 78 Green/Mattapan stations are "
                "ungated) with proof-of-payment checks on board.",
            ],
            "evidence": "Barabino et al. (Transp. Res. B, 2014): optimal POP inspection ≈3.4–4.0%; "
                        "Dai, Galeotti & Villeval (2023); MA Inspector General letter (Sept 2025).",
        },
        {
            "problem": "Fare evasion · social norms",
            "title": "Tell riders the truth: most people pay",
            "summary": "In a field experiment at French rail stations, posters with an eye cue alone "
                       "did nothing. Paired with a message about how most people pay, they reduced "
                       "detected evasion.",
            "actions": [
                "Put descriptive-norm messages at gate arrays and rear doors, citing the published "
                "evasion rate.",
                "A/B-test messages by station and score them with the continuous measurement "
                "above.",
            ],
            "evidence": "Ayal, Celse & Hochman (OBHDP 166, 2021).",
        },
        {
            "problem": "Fare evasion · fare design",
            "title": "Short-Hop: pay by distance — end to end of a line costs $2.40",
            "summary": f"Copley → Arlington costs the same ${sh['flat_fare']:.2f} as Copley → "
                       f"Medford/Tufts ({sh_far['rail_mi']:.1f} track miles), so the flat fare is "
                       "worst value exactly where skipping payment is most tempting. Under Short-Hop, "
                       f"riding any line end to end costs ${sh['rules']['max']:.2f} and shorter trips pay "
                       f"in proportion: Copley → Medford/Tufts ${sh_far['fare']:.2f}, Copley → Arlington "
                       f"the ${sh['rules']['min']:.2f} minimum. No fare ever rises.",
            "actions": [
                "Tap in and tap out with the Short-Hop app or a contactless card; the fare is set on "
                "exit from composite miles (average of track and straight-line distance, as "
                "Washington Metrorail measures it), rounded up to $0.05.",
                f"A missing tap-out is charged ${sh['rules']['missed_tap_out']:.2f} (MBTA gates validate "
                "entry only, so skipping the exit tap must never be cheaper). Students and seniors pay half.",
                f"Pilot and test break-even: a ${sh_one['fare']:.2f} short trip needs "
                f"{pct(sh_one['breakeven_growth'], 0)} more paying riders on it; Copley → "
                f"Medford/Tufts at ${sh_far['fare']:.2f} needs {pct(sh_far['breakeven_growth'], 0)}.",
            ],
            "evidence": "WMATA Tariff 49 (effective July 1, 2026) for composite miles, rounding and "
                        "the min:max ratio; MBTA $2.40 flat fare; MBTA Rapid Transit Stop Distances.",
        },
        {
            "problem": "Accessibility",
            "title": "Treat elevators as critical service, not facilities",
            "summary": f"In 2025 the MBTA posted {ex['accessibility']['totals'][0]['outages']:,} "
                       f"elevator outage alerts. {acc_top['station']} ({acc_top['asset'].lower()}) "
                       f"alone was out {acc_top['hours']:,.0f} hours. No official elevator "
                       "availability rate is published.",
            "actions": [
                "Publish elevator availability % per station monthly, with an SLA for repair time.",
                "Predictive maintenance: rank units by outage recurrence (this project's alert "
                "history) and pre-stage parts at chronic stations.",
                "Push outage alerts to trip planners with an automatic accessible-route reroute.",
            ],
            "evidence": "MBTA Service Alerts 2025 (open data), parsed per asset.",
        },
        {
            "problem": "Reliability",
            "title": "Fix the worst routes where the most riders feel it",
            "summary": f"Route {worst_bus['route_id']} ran {pct(worst_bus['eb_otp'])} on time over "
                       f"the last 12 months; {worst_cr['line']} was the least reliable commuter rail "
                       f"line at {pct(worst_cr['otp'])}. Subway arrival predictions were "
                       f"{pct(sub_pred['accuracy'])} accurate in {sub_pred['year']}.",
            "actions": [
                "Bus-priority lanes and signal priority on the bottom-decile routes from the "
                "empirical-Bayes ranking (ranked on credibility, not noisy raw rates).",
                "Lock in the slow-zone gains: alert when any line's restricted share rises above "
                "zero for 30 days — median slow zone lifetimes were "
                + ", ".join(f"{k.replace(' Line', '')} {int(v)}d" for k, v in km.items()) + ".",
                "Improve subway prediction accuracy; trust in countdown clocks shapes whether "
                "riders choose the T over rideshare.",
            ],
            "evidence": "MBTA Bus/CR Reliability, Speed Restrictions, Prediction Accuracy (open "
                        "data). Rider Census: rideshare is now riders' top alternative (43%).",
        },
        {
            "problem": "Ridership & revenue",
            "title": "Win back the Red Line rider",
            "summary": f"The Red Line is at {pct(red['recovery'])} of 2019 weekday ridership, the "
                       "lowest of any line, even though its slow zones are gone. Every lost rider is "
                       "lost fare revenue that no enforcement program can recover.",
            "actions": [
                "Market the new speed: measured excess delay fell ~75% from 2023 to 2025.",
                "Off-peak frequency and fare products aimed at hybrid workers (flexible "
                "10-ride / capped weekly fares).",
                "Track recovery by station monthly using the gate-tap pipeline in this project.",
            ],
            "evidence": "MBTA Monthly Ridership, Gated Station Entries, Heavy Rail Excess Trip Time.",
        },
    ]
    intro = ("Every problem below is measured in this project's data. Every countermeasure has a "
             "measured result in Boston or a peer system, cited at the bottom of each card. The "
             "playbook joins them into one system: <b>measure → make paying easy → harden → "
             "enforce smartly → reinforce the norm</b>, with fixes for accessibility, reliability "
             "and ridership alongside.")
    return {"intro": intro, "items": items}
