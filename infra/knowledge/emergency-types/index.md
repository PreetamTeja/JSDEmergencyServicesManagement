---
type: EmergencyTypeIndex
title: Emergency Type Definitions
description: Mapping from caller speech patterns to dispatch fields (kind, case_type, severity). Used by the voice agent NLU.
timestamp: 2026-06-30T00:00:00Z
tags: [emergency, NLU, dispatch, voice]
---

# Emergency Types

Two dispatch `kind` values: `medical` and `fire`. Severity is `Critical`,
`Urgent`, or `Normal`. Case type applies only to medical.

## Kind: fire

Trigger words: fire, smoke, blaze, burning, flame, explosion, gas leak,
chemical, fumes, smoke coming out, something on fire.

Always dispatch a **fire truck**. Severity defaults to `Critical`.

Special: if caller says "gas leak" or "chemical smell" with no visible fire →
still `fire` kind, `Urgent` severity (hazmat approach).

## Kind: medical

All other health/injury emergencies. Dispatch an **ambulance**.

| case_type | Trigger words / symptoms | Default severity |
|-----------|--------------------------|------------------|
| [Cardiac](cardiac.md) | heart attack, chest pain, heart, cardiac, not breathing, collapsed, unconscious | Critical |
| [Trauma](trauma.md) | accident, fall, fracture, bleeding, crush, injury, road accident, hit, knocked | Urgent |
| [General](general.md) | sick, unwell, fever, vomiting, fainting, dizzy, general illness | Normal |
| [Maternity](maternity.md) | labour, delivery, pregnant, birth, baby coming, contractions | Urgent |
| [Pediatric](pediatric.md) | child, baby, infant, toddler, kid sick, child injured | Urgent |

## Mass Casualty

Trigger: bomb, blast, explosion, stampede, building collapse, gas explosion,
many injured, multiple casualties, mass accident.

→ kind=`medical`, case_type=`Trauma`, severity=`Critical`, patients=stated
count (estimate generously). Backend will dispatch multiple ambulances.
