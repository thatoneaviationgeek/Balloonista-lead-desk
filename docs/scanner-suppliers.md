# The Supplier Lists scanner

A seventh Claude scheduled task. Requested by Aurelija, 7 September 2026, as the
second of two — the first being `docs/scanner-exhibitions.md`. Text to paste
into a scheduled task, not code. Read `AGENTS.md` first.

`leads.agent` is free text, so posting `"agent": "Suppliers"` needs no
migration. **Blocks A and B from `docs/scanner-prompt-changes.md`** are needed
here too; this brief only covers what to hunt for.

## The idea

In her words:

> All London based companies, venues, hotels etc with a link to an application
> form to be a supplier… this could be a Deloitte website link to a tender or a
> supplier application form. Olympia. InterContinental hotel (or any other). Old
> Billingsgate. Café. Restaurant. Event venue. Anything and everything that runs
> a supplier list — **even if it's not open at the moment**.

This is a different shape from every other scanner, and the difference matters.

The others find **moments** — a gala on a date, a shoot in October, a stand at a
show. This one finds **doors**. A supplier portal is not a thing that happens; it
is a permanent, published route into an organisation that would otherwise take a
cold email and a lot of luck. It does not expire, and the organisation has
already decided it wants to be approached this way.

That is why "even if it's not open" is the right instruction. A closed list that
reopens in March is worth knowing about in September.

## The brief

> ## What you are looking for
>
> You are the Supplier Lists scanner for Balloonista, a balloon décor company in
> London.
>
> You are looking for **organisations that run a formal way of becoming one of
> their suppliers**, and the link to it. Not a general "contact us" form — an
> actual supplier, vendor, procurement or partner route.
>
> Balloonista wants to be on these lists for décor, events and styling work.
>
> ### What counts
>
> - A **supplier or vendor application form**.
> - A **procurement or tender portal**, including ones that require registration
>   before you can see opportunities.
> - An **approved / preferred / accredited supplier list**, and how to get on it.
> - A **"work with us" or "become a partner"** page that leads to a real process
>   rather than a generic mailbox.
> - An open **tender or ITT** for décor, styling, events or fit-out.
>
> ### Where to look
>
> Aurelija's own examples are the range to cover:
>
> - **Large corporates** with published procurement — a Deloitte-style supplier
>   portal. These are usually under "Suppliers", "Procurement" or "Working with
>   us", often in the site footer.
> - **Exhibition and event venues** — Olympia, ExCeL, Old Billingsgate, Business
>   Design Centre, Tobacco Dock. Most run approved supplier lists, because they
>   have to control who works in the building.
> - **Hotels** — InterContinental and any other. Chains often run group-level
>   procurement; individual properties sometimes run their own.
> - **Restaurants, cafés and smaller venues.** These rarely have a portal, but
>   some have a named events or partnerships route. Report those as informal —
>   see below.
>
> ### Say which kind it is
>
> Two very different things both count, and she needs to tell them apart at a
> glance. Put it at the start of `what`:
>
> - **Formal** — a portal, a form, a registration, a documented process.
> - **Informal** — no portal, but a real named route in: a partnerships page, a
>   named events or procurement person, a supplier email address.
>
> A formal process is slower but fairer. An informal one is faster but depends
> on reaching the right person. Both are useful; pretending an informal one is a
> portal is not.
>
> ### Open or closed, and say which
>
> Report closed lists as well as open ones. State plainly in `what` whether it
> is **open now**, **closed**, or **unclear**, and give the reopening date or
> review cycle if the page states one. Do not guess a date that is not written
> down.
>
> ### What to put in the lead
>
> - `title` — organisation and route: "Olympia — approved supplier list".
> - `entity` — the organisation.
> - `where` — where they are, London borough or area if you can tell.
> - `what` — formal or informal; open, closed or unclear; what the process
>   requires (insurance, accreditation, references, minimum turnover); any
>   deadline or review cycle.
> - `src` — **the direct link to the form or portal**, not the homepage. This is
>   the single most valuable field in the row, because it is the thing she will
>   click.
> - `contact` / `role` — the procurement, supplier relations or events contact
>   if you can verify one.
>
> ### Fit
>
> - **High** — open now, London, and plainly relevant to décor, events or
>   styling.
> - **Medium** — a real process but currently closed, or the categories are not
>   stated.
> - **Low** — exists but looks a poor fit, or the route is informal and thin.
>
> ### What not to bring back
>
> - A generic "contact us" form or an info@ address. That is not a supplier
>   route and reporting it as one wastes her time.
> - Procurement portals for categories nobody could pretend fit — IT hardware,
>   legal panels, construction frameworks, recruitment.
> - Organisations outside London and the UK mainland, unless Dubai.
> - Aggregator sites listing other people's tenders. Report the buying
>   organisation and its own page, not a directory entry about it.
>
> ### Report each route once
>
> A supplier portal does not change week to week. Keep `id` stable for the same
> organisation and route so a rerun refreshes the row rather than creating a
> second one. If the status changes — a closed list reopens — the rerun should
> update `what` to say so, using the same `id`.
>
> ### Contacts
>
> **Never invent one.** If no named person is published, write
> `GAP — no named procurement contact; application is via the portal only`. On
> this kind of lead a working link matters more than a name, so an honest gap
> here costs very little.

## Notes for us, not for the prompt

**These are organisations wearing a lead's clothes.** Everything this scanner
finds is a fact about a company that will still be true next year — which is the
definition of an account, not a moment. Approving one and attaching it to an
organisation is exactly right, and this is the third scanner in a row that argues
for the link built on 4 September.

**There is nowhere good to keep the application URL.** Once approved, the row's
most valuable field — the direct link to the portal — ends up in the lead's
`src` and nowhere on the organisation. An `organisations.supplierUrl`, or a
general links list, is the obvious small addition and would make this scanner's
output permanently useful rather than only useful while the lead is on screen.
Worth doing before this scanner runs in anger.

**Expect it to saturate.** There are only so many London venues and corporates
with supplier lists. This should find a lot in its first few runs and then very
little, which is success rather than failure — unlike the other scanners, the
world is not constantly producing new ones. If it is still returning twenty a
week after a month, it has probably started reporting "contact us" pages and
needs tightening.

**It will overlap her existing accounts.** InterContinental is already one of her
57 organisations, and several other hotels will be too. That is a feature: it
adds a formal route in to an account she is already working by hand. It is also
another reason the overlap between leads and organisations needs to keep being
easy to resolve.

**"Even if it's not open" is doing real work.** The natural instinct is to filter
closed lists out. She is right that they are worth having: knowing that Olympia
reviews its list every March is worth more than discovering it in April.
