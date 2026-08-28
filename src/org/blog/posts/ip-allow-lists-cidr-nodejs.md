---
layout: post.html
permalink: /blog/ip-allow-lists-cidr-nodejs/
templateEngineOverride: md
title: "Checking an IP against 10,000 networks without comparing it to 10,000 networks"
summary: "Every request asks the same question — is this one of ours? — and the loop you wrote to answer it gets slower every time someone adds a partner range. Here is how to answer it in logarithmic time instead, what an address really is once you stop treating it as a string, and the quiet precondition that a fast implementation must uphold or it will lie to you."
description: "How to test whether an IP address falls inside any of your CIDR networks in Node.js without a linear scan: addresses as integers, sorted disjoint ranges, binary search, and the traps — malformed input that throws, host bits silently discarded, and overlapping ranges that must be coalesced first."
keywords: "ip allow list nodejs, check if ip is in cidr range javascript, cidr matching nodejs, ip range lookup typescript, subnet membership check nodejs, ipv6 cidr matching, binary search ip ranges, imqueue net, allowlist ip address express, cidr contains ip nodejs"
date: 2026-08-28
author: mykhailo-stadnyk
illustration: cidr-match
topics: [security, performance, patterns]
ogType: article
---

The allow-list starts as four lines in a config file. The office, the VPN, the
monitoring box, and whatever CI runs on. You write the obvious loop, it works,
and you never think about it again.

Then it grows. A partner needs access, so that is two more ranges. The company
moves to a second region. Someone adds the pod CIDR so health checks stop being
rate-limited. A year later there are three hundred entries, half of them
inherited from a person who has left, and the loop is still there — running on
every single request, comparing the caller against every network in turn until
it finds one or runs out.

Nobody notices, because it is still fast enough. It is fast enough right up
until it isn't, and by then the loop is not the interesting problem anyway. The
interesting problem is that a check like this can be *wrong* in a way that
produces no error, no log line, and no clue — it just answers `false` for
someone who should have been let in, and you find out when they tell you.

Both of those are worth fixing, and they turn out to have the same fix.

## The loop is fine. It is just the wrong shape as the list grows

Here is what almost everyone writes first, in some form:

```typescript
function isAllowed(ip: string, networks: string[]): boolean {
    return networks.some(cidr => inRange(ip, cidr));
}
```

There is nothing wrong with this. For four networks it is the correct amount of
code, and reaching for anything cleverer would be a mistake.

What it hides is a cost that scales the wrong way. Every call re-parses the
address, then walks the list comparing against each network until it hits. A
match near the front is cheap. A **non-match is always the worst case**, because
proving an address is in none of your networks means checking all of them —
and on an allow-list, non-matches are the common case. That is the request from
the open internet, which is most of your traffic.

So the work per request grows with the length of a list that only ever gets
longer, and it grows fastest on exactly the path you care least about.

## An address is a number, and everything gets easier once it is one

The mental shift that makes this tractable: stop thinking of `10.1.2.3` as a
string with dots in it. It is a 32-bit number that someone wrote down in a
readable way. `2001:db8::1` is a 128-bit number with the same courtesy applied.

Once it is a number, a CIDR network stops being a pattern to match and becomes
something much more boring — a **contiguous range**. `10.0.0.0/8` is not a rule
about leading octets, it is every number from `10.0.0.0` to `10.255.255.255`
inclusive. That is it. That is the whole idea.

`@imqueue/net` exposes the conversion directly, which is useful for seeing it:

```typescript
import { ipToInt, cidrToRange } from '@imqueue/net';

ipToInt('10.0.0.1');            // 167772161n
cidrToRange('10.0.0.0/30');     // [ '10.0.0.0', '10.0.0.3' ]
```

Note the `n`. These are `bigint`s, not numbers, and that is a deliberate choice
rather than an overcautious one: a 128-bit IPv6 address does not fit in a
JavaScript `number`, and `bigint` is what lets **one** comparison path serve
both families instead of two implementations that drift apart.

So "is this address in this network?" reduces to `start <= addr && addr <= end`.
And "is this address in *any* of these networks?" reduces to a question about a
list of ranges — which is a problem with a much better known answer than a
question about a list of strings.

## Sort the ranges and you can throw half of them away at a time

If the ranges are sorted and non-overlapping, they form an ordered partition of
the address space. That means you never have to look at most of them. Compare
against the middle range: if the address is below it, every range above is
irrelevant; if above, every range below is. Discard that half and repeat.

Twenty comparisons is enough to find your way through a million networks. Ten
covers a thousand. The list can grow by orders of magnitude and the lookup grows
by a handful of comparisons.

That is what `Networks` does. You hand it CIDR strings and ask it questions:

```typescript
import { Networks } from '@imqueue/net';

const allowed = new Networks([
    '10.0.0.0/8',
    '192.168.0.0/16',
    '2001:db8::/32',
]);

allowed.includes('10.1.2.3');     // true
allowed.includes('8.8.8.8');      // false
allowed.includes('2001:db8::1');  // true
```

Under the hood each network is stored as a start/end pair in a `Buffer` — 8
bytes per IPv4 record, 32 per IPv6 — sorted once at construction. The two
families never share a buffer, because the record sizes differ; `Networks` keeps
one list per family and dispatches on the address you hand it. Asking a
v4-only list about a v6 address returns `false` rather than throwing.

The input does not need to be sorted, and it does not need to be tidy. Sorting
happens at construction, once, no matter how many times you then call
`includes()`.

## The precondition that has to hold, or the search quietly lies

Here is the part worth slowing down for, because it is the part that bit us.

Binary search does not merely *prefer* sorted, disjoint ranges — it is only
**valid** on them. The whole method rests on one claim: if the address is below
the range I am looking at, it cannot be in anything above it. Overlapping
records break that claim. A range that starts early but extends far can sit low
in sort order while covering an address that sorts high, and the search will
discard it along with its half of the list, never having compared against it.

Which means the answer comes back `false`, confidently, with nothing to
indicate anything went wrong.

`@imqueue/net` 3.0.3 had exactly this bug, and I want to describe it precisely
because the shape of it is instructive:

```typescript
// @imqueue/net 3.0.3
const nets = new Networks([
    '10.0.0.0/8',      // covers 10.9.9.9
    '10.1.0.0/16',     // a subnet of the above
    '172.16.0.0/12',
]);

nets.includes('10.9.9.9');  // false — and 10.0.0.0/8 plainly covers it
```

The ranges were sorted, but never coalesced. `10.1.0.0/16` is inside
`10.0.0.0/8`, the two overlap, the precondition fails, and the search walked
past the record that held the answer.

Two details explain how it survived review. First, it needs **three or more**
records to show itself — with two, the search compares against the one that
happens to be right often enough that a casual test passes. Second, listing a
supernet beside one of its own subnets looks redundant rather than dangerous, so
nobody writes that test on purpose. It is only in a config file that grew over
two years, where someone added `10.1.0.0/16` for a specific service without
noticing `10.0.0.0/8` was already three lines up, that you produce it by
accident.

And the failure direction matters. For an allow-list, this fails *closed* — the
legitimate caller gets refused. That is the better of the two directions, and it
is still a bad afternoon for whoever is on the other end.

**Fixed in 3.0.4**, by coalescing overlapping ranges at construction. It is
worth being precise about what that does and does not merge, because the
distinction is observable:

```typescript
// Overlapping: one contains the other, so they collapse into one record
const overlapping = new Networks(['10.0.0.0/8', '10.1.0.0/16']);
overlapping.ipv4.length;   // 1
overlapping.toArray();     // [ '10.0.0.0/8' ]

// Adjacent: they touch but neither contains the other — both records kept
const adjacent = new Networks(['10.0.0.0/25', '10.0.0.128/25']);
adjacent.ipv4.length;      // 2
adjacent.toArray();        // [ '10.0.0.0/25', '10.0.0.128/25' ]
adjacent.includes('10.0.0.200');  // true
```

Adjacency is deliberately left alone. Merging two touching `/25`s into a `/24`
would be *correct* about the addresses covered, but it would rewrite your
configuration into something you did not type, which makes `toArray()` useless
for showing an operator what is actually loaded. Only overlap is merged, because
only overlap threatens the search.

There is a structural reason this is simpler than it sounds. Two CIDR blocks can
never *partially* overlap. Each one is a power-of-two-sized range aligned to its
own size, so any two are either completely disjoint or one wholly contains the
other. "Coalescing overlap" therefore always means "discard the contained one" —
there is no case where two ranges have to be stitched into a wider one that
neither of them was.

The practical consequence for you: **the list you get back is not always the
list you passed in**. Duplicates collapse. Subnets listed beside their supernets
disappear into them. `length` can be lower than the number of lines in your
config, and `toArray()` will show you the supernet on its own. The set of
addresses covered is identical either way — it is only the record list that
differs — but if you log `toArray()` at boot to show what was loaded, know that
you are looking at the normalised form.

## Your allow-list will be handed something that is not an address

This is the trap most likely to reach production, and it has nothing to do with
performance.

`includes()` **throws** on input it cannot parse. It does not return `false`:

```typescript
const allowed = new Networks(['10.0.0.0/8']);

allowed.includes('not-an-ip');
// Error: Given network address "not-an-ip" is invalid!

allowed.includes('');
// Error: Given network address "" is invalid!
```

Read that next to where the address actually comes from. In front of an HTTP
service you are reading a client IP out of a socket or, more likely, out of a
proxy header — and a header is whatever the client felt like sending. A resolver
that returns `null` for a request it cannot attribute is normal. Feed either one
straight into `includes()` and your allow-list check becomes an unhandled throw
on the request path, triggered by an attacker-controlled string.

Guard it. `isValid()` is exported for this:

```typescript
import { isValid, Networks } from '@imqueue/net';

const ip = getClientIp(req) || '';

if (!isValid(ip)) {
    // Cannot attribute this request. Decide deliberately — do not fall
    // through into a membership test that will throw.
    return reject(429);
}

if (allowed.includes(ip)) { /* … */ }
```

That is not a hypothetical pattern. It is what `@imqueue/http-protect` does in
its own `verify()`, in that order, before it consults `safeNetworks` — and it
refuses the unattributable request rather than serving it unchecked, without
counting it in Redis, because pooling every unidentifiable client under one
counter would let a single one of them get the whole pool banned.

One sharp edge on `isValid()` worth committing to memory: it validates a **bare
address**, not a CIDR record. `isValid('10.0.0.0/8')` is `false`. When you are
checking configuration entries rather than client addresses, strip the prefix
first:

```typescript
const records = input.filter(r => isValid(r.split('/')[0]));
```

## Config-file realities: one bad line fails everything

The constructor throws rather than skipping. One malformed entry in three
hundred takes down the whole list — and, because you build it at startup, that
means the process does not come up:

```typescript
new Networks(['10.0.0.0/8', 'nonsense']);
// Error: Given network address "nonsense" is invalid!
```

This is the right default. A CIDR list is a security control, and silently
dropping the entry you could not parse is how an allow-list ends up quietly
narrower — or a ban-list quietly wider — than the file says it is. Failing at
boot is loud, immediate, and happens before any traffic arrives.

But it does mean untrusted or user-editable input should be validated before it
reaches the constructor, so you can report *which* line is wrong instead of
letting a stack trace do it.

Two more that catch people once:

**Every entry needs an explicit prefix length.** A bare `203.0.113.7` is
rejected — a single host is `203.0.113.7/32`, and a single IPv6 host is
`/128`. Be aware that this particular mistake surfaces as a parsing error from
deep inside the `bigint` conversion rather than a tidy validation message, so if
you see something about `NaN` and `BigInt` while loading config, look for a
missing `/32` first.

**Host bits are discarded, not honoured.** `10.1.2.3/8` is accepted and
normalised to `10.0.0.0/8`:

```typescript
new Networks(['10.1.2.3/8']).toArray();   // [ '10.0.0.0/8' ]
```

That is standard CIDR semantics and every other tool does the same, but it is
worth saying out loud, because the failure is silent and large. Someone intending
to allow one host, who types the prefix length of the surrounding network out of
habit, has just allowed sixteen million addresses. Nothing warns them. If you
take these from a UI, echo back what `toArray()` returns — the normalised form
is what is actually in force.

## What it actually costs

Measured on the published 3.0.5, 200,000 lookups per list size, probing an
address that is in none of the networks — the worst case, and the common one:

| Networks in the list | Per lookup |
|---|---|
| 10 | ~1,170 ns |
| 100 | ~1,530 ns |
| 1,000 | ~2,370 ns |
| 10,000 | ~3,290 ns |

A thousandfold increase in the list costs less than three times the work. That
is the shape you want, and it is the whole point.

The absolute numbers deserve an honest note, because they are larger than a
handful of integer comparisons has any right to be. Most of that time is not the
search — parsing the address string into a `bigint` costs around 110 ns on its
own and is paid identically whether the list holds ten networks or ten thousand.
The search is the cheap part; the constant is the string.

For comparison, on the same 10,000-network list, a linear scan over the already
parsed integer ranges — no string handling at all, the most favourable framing
for the naive approach — measured around 19,200 ns against 3,760 ns for the
full `includes()` call including its parse. The loop loses by roughly five times
while being handed a head start.

If you want the parsed ranges to build something else on, `toIntRanges()` gives
you `{ ipv4, ipv6 }` as arrays of `bigint` start/end pairs.

## Where this stops being the right layer

A membership test is a cheap, precise tool, and it is not a security boundary by
itself. Three limits worth being clear-eyed about:

**The address has to be true.** Everything above answers "is this address in the
list", not "is this request really from there". Behind a proxy you do not
control, the client IP comes from a header the client can set, and an allow-list
over a forgeable value is decoration. Terminate that question first — know which
proxy you trust and which header it sets — and only then ask about membership.

**Coarse ranges are a blunt grant.** `10.0.0.0/8` is sixteen million addresses,
and on a cloud provider a `/16` you were given may not stay yours in any
meaningful sense. An allow-list is a statement about network location, which is
a weak proxy for identity. It pairs well with authentication; it substitutes for
it badly.

**Volume belongs upstream.** If the reason you are matching IPs is to shed
abusive traffic, the application is the last place that work should happen —
every request you reject has already cost you a connection, a parse and a
process. A firewall, load balancer or edge rule does it before any of that.
Application-level matching is right for *policy* — exempting your own monitoring
from a rate limiter, gating an admin route, tagging internal traffic — and wrong
as a substitute for a network control.

Inside those limits it is a good tool, and it is the one `@imqueue/http-protect`
builds its `safeNetworks` exemption from: matching addresses short-circuit
`verify()` before it touches Redis, so your health checks are never counted,
never banned, and still answered `SAFE` when Redis itself is unreachable.

## FAQ

### How do I check whether an IP address is inside a CIDR range in Node.js?

Convert both to numbers and compare. A CIDR block is a contiguous range of
integers, so membership is `start <= address && address <= end`. For a single
network you can do that by hand with `cidrToRange()` and `ipToInt()`; for a list
of networks, build a `Networks` from `@imqueue/net` and call
`includes(address)`, which sorts the ranges once at construction and binary
searches them on every lookup.

### Is a linear scan over my networks actually a problem?

For a handful of networks, no — write the loop. It becomes a problem on two
axes at once: the list grows over years, and the cost is worst for non-matching
addresses, which on an allow-list is most of your traffic. Measured against
10,000 networks, a linear scan over pre-parsed ranges took roughly five times
longer than a full `Networks.includes()` call including its string parse.

### Why do overlapping CIDR ranges break a binary search?

Because the search assumes that if an address sorts below the range it is
examining, no range above can contain it. An overlapping record violates that:
it can start early — placing it low in sort order — while extending far enough
to cover an address that sorts high, so the search discards it unexamined and
answers `false`. This is why `@imqueue/net` coalesces overlapping records at
construction; disjointness is a correctness requirement, not an optimisation.

### What happens if I list a network and one of its subnets?

They are coalesced into the single record that covers both. Listing
`10.0.0.0/8` beside `10.1.0.0/16` is safe and answers every membership question
correctly, but the two collapse: `length` reports fewer networks than you
passed, and `toArray()` returns `['10.0.0.0/8']` alone. Adjacent-but-not-
overlapping ranges, such as two halves of a `/24`, are deliberately left as
separate records.

### Does an IP allow-list work for IPv6 too?

Yes, and it should be built for both from the start. Addresses are compared as
`bigint`, so the same code path serves a 4-byte and a 16-byte address; you pass
mixed v4 and v6 records to the same `Networks` instance and it dispatches on
whichever family the address you are testing belongs to. Internally each family
gets its own buffer, because an IPv6 record is 32 bytes against IPv4's 8.

### Will an invalid address make my check return false?

No — it throws. `includes()` rejects anything it cannot parse rather than
answering `false`, which matters because the address usually comes from a proxy
header the client controls. Validate with `isValid()` before testing membership,
and note that `isValid()` takes a bare address, not a CIDR record, so
`isValid('10.0.0.0/8')` is `false`.

## Reference

[`Networks`](/api/net/latest/net.networks/) ·
[`Networks.includes()`](/api/net/latest/net.networks.includes/) ·
[`Networks.toArray()`](/api/net/latest/net.networks.toarray/) ·
[`Networks.toIntRanges()`](/api/net/latest/net.networks.tointranges/) ·
[`NetworkList`](/api/net/latest/net.networklist/) ·
[`isValid()`](/api/net/latest/net.isvalid/) ·
[`cidrToRange()`](/api/net/latest/net.cidrtorange/) ·
[`ipToInt()`](/api/net/latest/net.iptoint/) ·
[`HttpProtectOptions.safeNetworks`](/api/http-protect/latest/http-protect.httpprotectoptions.safenetworks/) ·
[FAQ: how do I check whether an IP address is inside a CIDR range?](/api/faq/#how-do-i-check-whether-an-ip-address-is-inside-a-cidr-range)
