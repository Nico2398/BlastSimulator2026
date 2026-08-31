---
name: dev-design-principles
description: >
  Design philosophy for BlastSimulator2026 code meant to survive the project's evolution: single
  responsibility, coupling limits inside a layer, genericity without speculation, cost that scales
  with the game's growth axes, and extension without edit. Use when designing an API surface,
  implementing or refactoring a feature, or reviewing a change for durability.
---

## What durable means here

The game grows in one direction only: more rock types, more buildings, more vehicles, more events,
bigger levels, more employees. Code is durable when that growth costs an addition and not a rewrite.
Five questions decide it. Every one of them is answerable from the diff alone.

| Question | Passes when | Fails when |
|----------|-------------|------------|
| **One reason to change** | The unit changes only when its single concern changes | Its name needs "and"; a UI tweak and a balance tweak both edit it |
| **Coupling** | It names the fewest other units it can | It reads another module's internal shape, or takes a whole aggregate to use two fields |
| **Genericity** | It would still compile and make sense if the feature that motivated it were deleted | The mechanism branches on the caller it was written for |
| **Cost curve** | Its cost walks one growth axis, linearly | It scans two growing collections against each other, or recomputes a whole derived structure after a local change |
| **Extension** | The next variant is a catalog entry | The next variant edits a `switch` in three files |

## Coupling has levels

Layer boundaries in `dev-architecture` are the outer limit, not the whole rule. Inside one layer:

- **Narrowest input.** A function that needs a charge mass and a rock hardness takes two numbers,
  not `GameState`. Passing the aggregate couples the helper to every field it never reads and makes
  it untestable without building a world.
- **Depend on the interface.** `SaveBackend` in core with implementations outside it is the shape:
  the high-level unit names an abstraction, the concretion is chosen at the edge.
- **Own your shape.** Reaching field-by-field into another module's structure couples to that
  structure. Go through the owning module's exported function; when none fits, add one there.
- **Events are contracts.** An emitted event name and payload are read by units the emitter does not
  know. Widening a payload is additive; changing a field's meaning breaks silent subscribers.
- **One direction.** Any import that closes a cycle between two modules means the concern is split
  across the wrong seam.

## Generic means unaware, not configurable

Genericity is knowledge *removed*, not options added. A generic unit is smaller than the specific one
it replaced, not bigger.

- The mechanism is named for the operation, never the caller: a gate that resolves position-dependent
  actions serves survey, rest and boarding because it knows none of them by name — a new one adds a
  field, not a branch.
- Parameterize what a second real consumer actually varies. Today, in the diff, not one imagined.
- The test: delete, on paper, the feature that motivated the unit. If the unit still reads as a
  coherent tool, it is generic. If it names that feature in its logic, it is specific — which is
  fine, provided it sits where that feature lives.

**The counterweight.** Speculative generality costs more than the duplication it prevents. An
abstraction with one implementation, a type parameter that binds to one type, a registry with one
entry, a config flag deferring a decision nobody asked to defer — each is a layer to read through
forever, bought for a consumer that never arrives. The bar is a second real consumer today, **or** a
mechanism that got smaller by knowing less. One of the two, else keep it concrete.

Genericity is a property of the API surface, so it is decided when that surface is designed and
cleaned during refactor. A green phase writes the minimum that passes its tests and widens nothing.

## Cost curve

Growth axes this project actually moves along: voxels per level, employees, vehicles, buildings,
active contracts, fragments per blast, ticks per session, saved-state size.

- Anything per tick or per frame states the axis it walks. A pass over all entities is fine; a pass
  over all entities × all their tasks is a finding.
- Two growing collections compared against each other: index one, or narrow the scan by locality.
- A local change recomputes only what it touched. Rebuilding a whole navgrid or remeshing a whole
  terrain after one voxel changed is the shape to catch.
- Serialized state grows per entity. Derived data is recomputed on load, never saved.
- When the honest cost is unbounded, cap it and say so on the line — the per-blast fragment cap is
  the precedent. A cap is a decision, so it is recorded like one per `agentic-decision-autonomy`.

Measure before claiming a cost. An asserted complexity nobody ran is a guess.

## Extension without edit

- Adding a rock, ore, building tier, vehicle role or event is a catalog entry plus its translations —
  no edit to the code that consumes the catalog.
- One discriminated union with one exhaustive `switch` is the accepted dispatch: the compiler names
  every site the next variant must handle. The same discriminant switched in several files is the
  defect — the variant is not what needs fixing.
- When adding the Nth variant means editing N call sites, report the dispatch, not the variant.

## Review signals

Flag, with the growth or change that makes it hurt named concretely:

- A unit whose name needs "and", or that two unrelated reasons would edit
- A helper taking `GameState` to read two fields
- Field-by-field reads of another module's internal structure
- A general-purpose helper defined inside a feature module
- A mechanism branching on the one caller it was written for
- Nested iteration over two collections that both grow with the game
- Full recompute of a derived structure after a local change
- A new `switch` on a discriminant already switched elsewhere
- A new abstraction, type parameter, registry or flag with exactly one consumer

Leave alone:

- Concrete code that is honestly specific and lives where its feature lives
- Duplication under three tokens of logic, where extraction costs more than it saves
- A cost that is quadratic over a bounded set fixed by design
- "Could be reused someday" with no consumer today
- Design debt in code the change only read — that is recorded, not fixed here

Findings inside what the change wrote are fixed in this run; findings in code it only read are
dispositioned by the Follow-up Gate.
