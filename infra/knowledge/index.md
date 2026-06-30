---
type: KnowledgeBundle
title: JSD TATA Emergency Services — Operational Knowledge
description: >
  Structured knowledge for the voice emergency agent. Contains all dispatch
  locations, emergency-type definitions, and fleet context for Jamshedpur.
  Loaded into Bedrock system prompts at call time to improve NLU accuracy.
version: "1.0"
timestamp: 2026-06-30T00:00:00Z
tags: [emergency, jamshedpur, tata-steel, dispatch, voice-agent]
sections:
  - locations/index.md
  - emergency-types/index.md
  - vehicles/index.md
---

# JSD TATA Emergency Services — Knowledge Bundle

This bundle is consumed by the voice agent (`infra/voice/voice-agent.mjs`) to
resolve caller speech to structured dispatch fields. It follows the Open
Knowledge Format (OKF v0.1): plain markdown files with YAML frontmatter,
cross-linked, vendor-neutral.

## Why this exists

Callers say things like "near the blast furnace gate", "C-block", "behind
Keenan" or "the big hospital". A flat `id=name` list cannot resolve these.
This bundle gives the model the local geography, aliases, and context it needs.

## Sections

| Section | Purpose |
|---------|---------|
| [Locations](locations/index.md) | All 30 dispatch points with aliases, zone, type, coords |
| [Emergency Types](emergency-types/index.md) | Symptom → case_type and kind mappings |
| [Vehicles](vehicles/index.md) | Fleet summary (ambulance vs fire truck capabilities) |
