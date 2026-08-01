---
chapter: 4
title: "Domain services: PostgreSQL & in-memory data"
docLabel: TUTORIAL — CHAPTER 4
lead: "Add the remaining domain services — Car and Time-Table — an in-memory car catalog and a PostgreSQL-backed reservation time-table."
description: "Add the remaining @imqueue domain services: Car, an in-memory catalog from the EPA dataset, and Time-Table, PostgreSQL reservations via @imqueue/pg-sequelize."
keywords: "@imqueue domain services, car catalog microservice, self-describing services, @imqueue/pg-sequelize, Sequelize RPC microservice, PostgreSQL microservice, TypeScript service client"
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

## Car service requirements

- Source its car data from the EPA fuel-economy bulk dataset
  ([`vehicles.csv.zip`](https://www.fueleconomy.gov/feg/epadata/vehicles.csv.zip)) —
  download it, unzip it and parse the CSV.
- Cache the parsed data in an in-memory store, refreshed from the remote dataset
  every 24 hours.
- Expose a list of car objects (`CarObject`) with the following fields:
  * unique car identifier (`id: string`)
  * manufacturer name (`make: string`)
  * model name (`model: string`)
  * years of manufacture (`years: number[]`)
  * type (`type: string`) — one of `'mini'`, `'midsize'` or `'large'`, derived
    from the EPA vehicle class

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
running instances of the service. The reference implementation solves this with
a Redis `SET … NX` lock, so only one worker per host downloads and refreshes the
dataset — see `CarsDB` in the
[source](https://github.com/imqueue-sandbox/car).

## Time-Table service requirements

This is the central service. Use a relational database as its data store — the
reference implementation uses PostgreSQL, reached through
[`@imqueue/pg-sequelize`](/api/pg-sequelize/latest/), the framework's Sequelize
toolkit. Scaffold the service with that package already wired in:

~~~bash
imq service create time-table ./time-table --packages sequelize
~~~

The catalog id is `sequelize`, kept as it was when the package was renamed so
that existing configs keep working; what it installs is `@imqueue/pg-sequelize`,
and with it Sequelize, `sequelize-typescript` and the `pg` driver. See
[Package Catalog](/cli/package-catalog/) for the rest of the list.

Here is the interface expected for this service:

~~~typescript
/**
 * Returns the list of reservations for a given date (or for the current date
 * if omitted)
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
 - `boxes` — the number of parallel washing boxes (`number`)
 - `baseTime` — the duration options per washing type, as a list of:
   ~~~typescript
   {
      key: 'fast' | 'std' | 'full', // or whatever else...
      title: string,  // human-readable title for the washing type
      duration: number, // in minutes
   }
   ~~~

### The data layer

`@imqueue/pg-sequelize` re-exports everything `sequelize` and
`sequelize-typescript` export, so `Table`, `Column`, `DataType` and the rest
arrive from the same place as the package's own additions. That is what lets the
table and the wire format be a single declaration: put `@classType()` and
`@property()` from `@imqueue/rpc` on the same class that carries the Sequelize
decorators, and one file describes both.

~~~typescript
import {
    AllowNull, AutoIncrement, BaseModel, Column, ColumnIndex,
    DataType, IndexMethod, PrimaryKey, Table,
} from '@imqueue/pg-sequelize';
import { classType, property } from '@imqueue/rpc';

@classType()
@Table({
    tableName: 'Reservation',
    freezeTableName: true,
    timestamps: true,
    paranoid: true,
})
export class Reservation extends BaseModel<Reservation> {
    @property('number')
    @AutoIncrement
    @PrimaryKey
    @Column(DataType.BIGINT)
    public id: number;

    // GiST is the method that makes range containment — the query every read
    // runs — use an index instead of a scan
    @property('[string, string]')
    @ColumnIndex({
        name: 'reservation_duration',
        method: IndexMethod.GIST,
        safe: true,
    })
    @AllowNull(false)
    @Column(DataType.RANGE(DataType.DATE))
    public duration: [Date, Date];
}
~~~

Three things about the reference implementation are worth knowing before you
write your own:

- **The connection is a singleton the package owns.**
  [`database(dbConfig)`](/api/pg-sequelize/latest/pg-sequelize.database/) builds
  it on the first call and hands back the same instance on every later one,
  ignoring its argument — so those options are start-up configuration, not
  something to vary per call.
- **Models are discovered, not listed.**
  [`modelsPath`](/api/pg-sequelize/latest/pg-sequelize.imqormoptions.modelspath/)
  points at the *compiled* output, and each file under it must export a symbol
  named after itself — `Reservation.js` exporting `Reservation`. That is why the
  model lives in a directory of its own with nothing else in it: an `index.js`
  sitting alongside would hand Sequelize `undefined`.
- **Indices are declared on the columns.** `orm.sync()` creates the tables and
  then every index declared with `@ColumnIndex`. What that cannot express stays
  an explicit statement in the schema bootstrap — here the double-booking guard,
  whose key is one column plus two expressions.

The `fields?: string[]` parameter every read method above takes is not plumbing
you write by hand.
[`query.autoQuery()`](/api/pg-sequelize/latest/pg-sequelize.query.autoquery/)
turns it into the `SELECT` list, intersecting it with the model's real columns
and falling back to the primary key — so a gateway can pass its GraphQL
selection set straight through, and a name that is not a column never reaches
the SQL:

~~~typescript
return await Reservation.findAll(query.autoQuery<FindOptions>(
    Reservation,
    fields,
    {
        where: {
            duration: {
                [Op.contained]: [today(dateObj), tomorrow(dateObj)],
            },
        },
    },
));
~~~

`Op` is the one import that still comes from `sequelize` itself: its operators
are ES symbols, which is also why the package offers a JSON-friendly
[`FilterInput`](/api/pg-sequelize/latest/pg-sequelize.filterinput/) for filters
that arrive over the wire.

**Something to think about:** storing the time-table options as configurable
database records rather than as defaults in code.

Either way, the [complete source code is on GitHub](https://github.com/imqueue-sandbox/time-table).

Next up: [API Service — integration](/tutorial/api-service).
