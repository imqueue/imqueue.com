---
chapter: 4
title: Domain Services
docLabel: TUTORIAL — CHAPTER 4
lead: "Add the remaining domain services — Car and Time-Table — and choose how their typed clients are generated."
description: "Add the remaining @imqueue domain services (Car, Time-Table) and choose how their typed clients are generated — self-describing services in practice."
keywords: "@imqueue domain services, typed client generation, self-describing services, code generation RPC, PostgreSQL microservice, TypeScript service client"
ogType: article
---

By now it should be clear that building @imqueue services is a straightforward
process. To make the application fully functional we need two more services:
`Car` and `TimeTable`.

Building them isn't much different from the `User` and `Auth` services we've
already covered, so we suggest tackling them as homework. If you'd rather read
the finished code, both are on GitHub —
[Car](https://github.com/imqueue-sandbox/car) and
[Time-Table](https://github.com/imqueue-sandbox/time-table).

Here are the requirements.

### Car service requirements

- Source its car data from any available dataset — for example, this
  [publicly available vehicle database](https://www.fueleconomy.gov/feg/ws/index.shtml).
- Cache the data in an in-memory store, refreshed from the remote vehicle
  database every 24 hours.
- Expose a list of car objects (`CarObject`) with the following fields:
  * unique car identifier (`id: string`)
  * manufacturer name (`make: string`)
  * model name (`model: string`)
  * years of manufacture (`years: number[]`)
  * type (`type: 'mini' | 'midsize' | 'large'`)

Here is the interface the service is expected to implement:

~~~typescript
/**
 * Returns the list of car manufacturers (brands)
 *
 * @return {string[]} - the list of known brands
 */
public brands(): string[];

/**
 * Returns the car object for a given identifier, or a list of car objects if an
 * array of identifiers is given.
 *
 * @param {string | string[]} id - car identifier(s)
 * @param {string[]} [selectedFields] - fields to return
 * @return {Partial<CarObject> | Partial<CarObject | null>[] | null} - the found object(s), or null
 */
public fetch(
    id: string | string[],
    selectedFields?: string[],
): Partial<CarObject> | Partial<CarObject | null>[] | null;

/**
 * Returns the list of known cars for a given brand
 *
 * @param {string} brand - car manufacturer (brand) name
 * @param {string[]} [selectedFields] - fields to return
 * @param {string} [sort] - field to sort by, defaults to 'model'
 * @param {'asc' | 'desc'} [dir] - sort direction, defaults to 'asc' (ascending)
 * @return {Partial<CarObject>[]} - the list of matching cars
 */
public list(
    brand: string,
    selectedFields?: string[],
    sort: string = 'model',
    dir: 'asc' | 'desc' = 'asc',
): Partial<CarObject>[];
~~~

For implementation details, refer to the
[source code](https://github.com/imqueue-sandbox/car).

**Something to think about:** synchronising the in-memory data across multiple
running instances of the service.

### Time-Table service requirements

This is the central service. Use a relational database as its data store — for
example, PostgreSQL (or another of your choice) with the Sequelize ORM on top.

Here is the interface expected for this service:

~~~typescript
/**
 * Returns reservations starting from a given time (or from the current time if
 * omitted)
 *
 * @param {string} [date] - date to select reservations for; defaults to the current date
 * @param {string[]} [fields] - fields to select for each reservation
 * @return {Promise<Reservation[]>} - the matching reservations
 */
public async list(date?: string, fields?: string[]): Promise<Reservation[]>;

/**
 * Fetches a single reservation by its identifier
 *
 * @param {string} id - identifier of the reservation to fetch
 * @param {string[]} [fields] - fields to select for the reservation
 * @return {Promise<Partial<Reservation> | null>} - the reservation, or null if not found
 */
public async fetch(id: string, fields?: string[]): Promise<Partial<Reservation> | null>;

/**
 * Makes a reservation, or throws if it cannot be made
 *
 * @param {Reservation} reservation - the reservation data
 * @param {string[]} [fields] - fields to select for the updated reservations list
 * @return {Promise<Reservation[]>} - the updated reservations list
 */
public async reserve(reservation: Reservation, fields?: string[]): Promise<Reservation[]>;

/**
 * Cancels a reservation
 *
 * @param {string} id - reservation identifier
 * @param {string[]} [fields] - fields to select for the updated reservations list
 * @return {Promise<Reservation[]>} - the updated reservations list
 */
public async cancel(id: string, fields?: string[]): Promise<Reservation[]>;

/**
 * Returns the time-table configuration settings
 *
 * @return {Promise<TimeTableOptions>} - the time-table options
 */
public async config(): Promise<TimeTableOptions>;
~~~

It also exposes these complex types:

`Reservation`:
 - `id` — reservation record identifier
 - `carId` — user's car identifier
 - `userId` — user identifier
 - `type` — the washing type for this reservation, one of `'fast' | 'std' | 'full'`
 - `duration` — a range of start and end times

`TimeTableOptions`:
 - `start` — the station's opening time, in `HH:MM` format
 - `end` — the station's closing time, in `HH:MM` format
 - `baseTime` — the duration options per washing type, as a list of:
   ~~~typescript
   {
      key: 'fast' | 'std' | 'full', // or whatever else...
      title: string,  // human-readable title for the washing type
      duration: number, // in minutes
   }
   ~~~

**Something to think about:** (a) exposing a Sequelize model as an @imqueue
complex type; (b) storing the options as configurable database records.

Either way, the [complete source code is on GitHub](https://github.com/imqueue-sandbox/time-table).

Next up: [API Service — integration](/tutorial/api-service).
