# Why the Voice Agent Uses OKF, Not RAG

## 1. What "OKF" actually is here

There is no vector database, no embedding model, and no retrieval step anywhere in this
pipeline. "Open Knowledge Format" (OKF) in this codebase is just a directory of plain
markdown files with YAML frontmatter, checked into the repo at `infra/knowledge/` and
deployed alongside the Lambda binary into `knowledge/` next to `Function.cs`. At cold
start, `LoadOkf()` (`lambda/VoiceAgent/Function.cs:67-89`) does three things:

1. Reads `emergency-types/index.md` and `vehicles/index.md` in full.
2. Reads every `.md` file in `locations/` except `locations/index.md` (33 individual
   `loc-*.md` files, one per named place — hospitals, gates, markets, colonies, etc.).
3. Concatenates all of it into one string, joined with `\n\n---\n\n` separators, and
   caches it in the static field `OkfKnowledge` for the lifetime of the Lambda execution
   environment (`Function.cs:52`).

On every single `ExtractSlots()` call (`Function.cs:288-350`), that entire cached string
is dropped into the model's system prompt verbatim via `locationContext`
(`Function.cs:290-292`), ahead of the instructions telling Nova Lite how to map caller
speech to `kind`, `case_type`, `severity`, and `pickup_id`. There is no per-call filtering,
no chunking, and no attempt to figure out which of the 33 locations is actually relevant
to *this* caller before the model sees the prompt — the model gets all 33 and picks.

Contrast that with what a RAG pipeline for this same problem would look like: split each
markdown file (or each location's frontmatter+body) into chunks, embed each chunk with an
embedding model, store the vectors in something like OpenSearch/pgvector/a Bedrock
Knowledge Base, and then, per call, embed the live transcript, run a similarity search
against the vector store, and inject only the top-K nearest chunks into the prompt instead
of the full bundle. That is a materially different system: an indexing pipeline that has to
run whenever a markdown file changes, a vector store to provision and pay for, a
similarity-search call on the hot path before the LLM call, and a new failure mode (the
retriever returning the wrong or no chunks) that doesn't exist in the current design.

## 2. Why flat injection is the right call at this scale

The actual bundle, as loaded by `LoadOkf()` (index files plus the 30 individual location
pages under `locations/`), is:

- **35 files loaded** (2 index files + 30 `loc-*.md` + vehicles index, `emergency-types/index.md`
  counted once), pulled from 39 total markdown files in `infra/knowledge/` (a few, like the
  per-case-type pages `cardiac.md`/`trauma.md`/etc. and `locations/index.md`, are not
  loaded at all — see §5).
- **~17.4 KB / ~496 lines of text** once concatenated — roughly the size of the
  `emergency-types/index.md` file (42 lines) repeated forty times over.
- At roughly 4 characters per token, that's on the order of **4,000-4,500 tokens** of
  system-prompt overhead per call, against Nova Lite's context window (128K tokens) and its
  per-request pricing, where an extra 4K input tokens is a rounding error in both latency
  and cost.

Three properties of the domain make "just inject everything" a reasonable engineering
choice rather than a shortcut:

- **The domain is small and closed.** This is dispatch for one township — Tata Steel
  Jamshedpur — not an open-ended corpus. There are exactly 30 named locations, 5 medical
  case types, and 2 dispatch kinds (fire/medical). This is not going to grow the way a
  product-support knowledge base or a legal-document corpus would; it's bounded by the
  number of physical places emergency vehicles can be sent to in one town.
- **No retrieval failure surface.** RAG's actual failure modes — the embedding model
  missing a relevant chunk because the caller phrased something differently than the
  source doc, similarity search returning the wrong top-K, chunk boundaries splitting a
  location's aliases from its disambiguation note — simply don't exist here, because
  nothing is being selected. The model sees the *entire* fact base every time, so it
  cannot fail to retrieve a fact it needs.
- **Zero retrieval latency.** There's no embedding call and no vector-store round trip
  before the Bedrock `ConverseAsync` call. The whole knowledge lookup cost is "read a
  cached string," which is already paid for once at cold start.

## 3. Where this breaks down

The flat-injection approach is a function of the numbers above staying small. It stops
being reasonable if:

- **The bundle grows to cover multiple cities/regions.** Today it's 30 locations for one
  township. If the app expanded to dispatch across, say, 10 townships with a few hundred
  locations each, the bundle would be tens to hundreds of KB, adding real per-call token
  cost (and Nova Lite's context window, while large, is not infinite headroom for a
  system prompt that's supposed to be a small fraction of the budget).
- **Prompt dilution starts hurting accuracy.** More critically than raw token cost: LLMs
  are demonstrably worse at picking one needle out of a large, mostly-irrelevant haystack
  than a small, curated one. With 30 locations the model can plausibly hold "all of Jamshedpur"
  in its attention; with 500 near-identical `loc-*` entries across several cities, the
  chance the model mismatches "TMH" to the wrong city's hospital goes up, not down.
- **The bundle starts including things that change per-query relevance, not just
  content.** Historical case data (e.g., "which hospital usually takes cardiac cases from
  this zone") is fundamentally a different kind of knowledge — high-volume, continuously
  updated, and only a tiny fraction relevant to any one call. That's exactly the shape of
  problem retrieval-based selection exists for.

At that point, the trade flips: RAG's per-call cost of an embedding + similarity search
becomes cheaper than shipping the whole bundle on every call, and its selectivity
directly fixes the accuracy problem flat injection would start causing.

## 4. Comparison at this use case's actual scale

| Dimension | OKF (current, ~17 KB / 35 files) | RAG (hypothetical, same content) |
|---|---|---|
| Per-call latency | Zero extra hops — bundle is a cached string | +1 embedding call, +1 vector-store query before the LLM call |
| Per-call cost | ~4K extra input tokens to Nova Lite, negligible | Embedding cost + vector-store query cost + fewer prompt tokens (only top-K) |
| Build/maintain complexity | None — markdown files, `git`, redeploy | Indexing pipeline, chunking strategy, vector DB provisioning/ops, re-embed job |
| Accuracy/relevance risk | Model must disambiguate from full text, but never "misses" a fact that exists in the bundle | Retriever can miss/misrank the right chunk; but avoids prompt dilution at larger scale |
| Freshness/update story | Edit a `.md` file, redeploy the Lambda (or just its knowledge assets) — done | Edit source doc, re-run embedding + re-index, verify the index updated before it's trusted |
| Fit at current scale (30 locations, 5 case types, one township) | Good | Overkill — the ops burden buys nothing at this size |
| Fit if scaled to many cities / historical data | Degrades — cost and dilution grow with corpus | Becomes the better tradeoff |

## 5. Honest downsides of the current approach

The OKF design is a reasonable choice for this scale, not a free lunch:

- **Every call pays for the whole bundle even though ~29/30 locations are irrelevant to
  any single caller.** A caller near TMH still causes the model to read all 30 location
  pages, all vehicle info, and the full emergency-type table on every turn of the
  conversation (`ExtractSlots` is called once per turn, and the transcript is re-sent with
  the full bundle each time — `Function.cs:145,288-292`). There's no caching of "this
  caller's location is probably X" across turns; the same ~4K tokens of largely-unused
  context is paid for repeatedly within a single call.
- **No relevance ranking, so disambiguation is entirely the model's job.** If a caller says
  something that's ambiguous between two locations with similar names or aliases (e.g.
  overlapping alias lists in `loc-sakchi.md` vs. `loc-sakchimkt.md`), there's no ranked
  "most likely match" signal from a retriever — the model has to resolve it purely from
  reading the raw alias lists in prose, the same way a human skimming a phone book would.
  A retrieval step with a similarity score would at least surface a ranked shortlist;
  here, a mis-set `pickup_id` fails silently into the code's own regex-based
  `ResolveLocation()` fallback (`Function.cs:400-421`) rather than being caught upstream.
- **Some content is authored but never loaded.** `locations/index.md` and the per-case-type
  pages (`emergency-types/cardiac.md`, `trauma.md`, `general.md`, `maternity.md`,
  `pediatric.md`) exist in `infra/knowledge/` but `LoadOkf()` never reads them — only
  `locations/*.md` (excluding `index.md`) and the two top-level `index.md` files are
  loaded. That's a maintenance trap: someone can edit `cardiac.md` expecting it to affect
  model behavior and it silently won't, because nothing points at it. Flat file-concatenation
  has no equivalent of a RAG index's "this document round-trips through retrieval" guarantee
  — inclusion is decided by a hardcoded file list in `LoadOkf()`, and there's no signal when
  a file falls out of sync with that list.
- **No incremental cost model.** Because everything loads unconditionally, there's no way to
  see (without instrumentation) which parts of the bundle are actually being used by the
  model to make its decision versus dead weight — a RAG system's retrieved-chunk log would
  give that visibility for free; here it doesn't exist unless someone builds it separately.

## Bottom line

For a single-township emergency line with 30 fixed locations, 5 case types, and 2 dispatch
kinds, OKF's "load everything at cold start, inject it whole" design trades a small,
constant per-call token cost for zero retrieval infrastructure and zero retrieval failure
modes — a good trade at this size. It is not a general RAG substitute; it is a shortcut
that works because the knowledge base is small and closed. The point at which it should be
replaced with real retrieval is legible in advance: multi-city expansion, large numbers of
near-duplicate location entries, or inclusion of high-volume historical data are the
signals to watch for.
