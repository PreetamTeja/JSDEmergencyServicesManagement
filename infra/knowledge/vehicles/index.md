---
type: VehicleFleetSummary
title: Emergency Fleet — JSD TATA
description: Fleet capabilities and dispatch rules for the voice agent. Determines which vehicle type to dispatch based on emergency kind.
timestamp: 2026-06-30T00:00:00Z
tags: [fleet, ambulance, firetruck, dispatch]
---

# Emergency Fleet

## Ambulance

- **Dispatched for:** `kind = medical`
- **Tank:** 60 L, ~9 km/L
- **Capacity:** 1–2 patients (mass casualty: multiple units dispatched)
- **Refuel threshold:** below 12 L (20% of 60 L) → goes to [Fuel Depot](../locations/loc-fuel.md) for refuel
- **Caller cue:** "ambulance", "medical help", "doctor", "hospital", "hurt"

## Fire Truck

- **Dispatched for:** `kind = fire`
- **Tank:** 200 L, ~5 km/L
- **Refuel threshold:** below 40 L (20% of 200 L)
- **Caller cue:** "fire truck", "fire engine", "fire brigade", "fire"

## Dispatch Rules

| Situation | Kind | Vehicle |
|-----------|------|---------|
| Fire, smoke, blaze | fire | Fire Truck |
| Gas leak, chemical fumes | fire | Fire Truck |
| Heart attack, chest pain | medical | Ambulance |
| Road accident, injury | medical | Ambulance |
| Sick person | medical | Ambulance |
| Explosion + injuries | medical | Ambulance (multiple) |
| Explosion (fire only, no injuries stated) | fire | Fire Truck |

## Zones

- **Zone-A:** Industrial (plant, workshop, gate, fuel depot, burma mines, golmuri)
- **Zone-B:** Central residential + civic (bistupur, sakchi, TMH, station, jubilee, keenan)
- **Zone-C:** Western residential + education (kadma, sonari, telco, XLRI, NIT, JRD)
- **Zone-D:** Northern (mango, domuhani)
