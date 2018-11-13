---
layout: page
title: "Tutorial"
section_id: docs
---

<div class="content">
    <div class="special-title centered-text">
        <i class="icon-book goldenrod-text"></i>
        <h1>{{ page.title }}</h1>
        <p>
            Step-by-step guide of building back-end services for car washing
            web application using @imqueue.
        </p>
        <p>
         For those who prefer to learn by example.
        </p>
        <p class="shortline"></p>
        <div class="spacing"></div>
    </div>
</div>
<div class="large-3 columns right panel radius toc" markdown="1">
<h4>Table Of Contents</h4>
<h5>Chapter 4. Other Services</h5>
{:#toc}
* TOC
{:toc}

<h5>Next Chapters</h5>
<div markdown="1">
 - [Chapter 5. API service. Integration](/tutorial/api-service)
 - [Chapter 6. Deployment](/tutorial/deployment)
</div>

<h5>Previous Chapters</h5>
<div markdown="1">
 - [Chapter 1. Introduction](/tutorial/)
 - [Chapter 2. User Service. Creating First Service](/tutorial/user-service)
 - [Chapter 3. Auth service. Inter-Service Communication](/tutorial/auth-service)
</div>
</div>

<h2>Chapter 4. Other Services</h2>

At this point it should be already clear, that building @imqueue
services is an easy process. To make our app fully functional we need
to develop two more services: `Car` and `TimeTable`.

Building them does not differ too much of what have been done for two
previous services - `User` and `Auth`, so it is suggested to work on
them as your homework. Or you can simple refer their
[source](https://github.com/imqueue-sandbox/car)
[code](https://github.com/imqueue-sandbox/time-table) at GitHub.

Here are the requirements.

### Car Service Requirements

- It should utilize data about cars from any available data source, for
  example, this one [publicly available vehicle database](https://www.fueleconomy.gov/feg/ws/index.shtml)
- It should implement in-memory data storage with data update each 24
  hours from a selected remote vehicle database.
- It should Provide access to the list of car object containing the
  following data (`CarObject`):
  * Unique car identifier (`id: string`)
  * Car manufacturer name (`make: string`)
  * Car model name (`model: string`)
  * Car years of manufacturing (`years: number[]`)
  * Car type (`type: 'mini' | 'midsize' | 'large'`)

Here are an interface of the service which is expected to be implemented:

~~~typescript
 /**
 * Returns a list of car manufacturers (car brands)
 *
 * @return {string[]} - list of known brands
 */
public brands(): string[];
/**
 * Returns car object by its identifier or if multiple identifiers given
 * as array of identifiers - returns a list of car objects.
 *
 * @param {string | string[]} id - car identifier
 * @param {string[]} [selectedFields] - fields to return
 * @return {Partial<CarObject> | Partial<CarObject|null>[] | null} - found object or null otherwise
 */
public fetch(
    id: string | string[],
    selectedFields?: string[]
): Partial<CarObject> | Partial<CarObject|null>[] | null;
/**
 * Returns list of known cars for a given brand
 *
 * @param {string} brand - car manufacturer (brand) name
 * @param {string[]} [selectedFields] - fields to return
 * @param {string} [sort] - sort field, by default is 'model'
 * @param {'asc' | 'desc'} [dir] - sort direction, by default is 'asc' - ascending
 * @return {Partial<CarObject>[]} - list of found car objects
 */
public list(
    brand: string,
    selectedFields?: string[],
    sort: string = 'model', dir: 'asc' | 'desc' = 'asc'
): Partial<CarObject>[];
~~~

For any details and help about implementation, please refer
corresponding [source code](https://github.com/imqueue-sandbox/car).

**What to think about:** In-memory data synchronization when running
multiple instance of services.

### TimeTable Service Requirements

That should be a central service. Let's consider using relational
database as data storage engine, for example, PostgreSQL or any other
at your choice with Sequelize ORM library on top.

Here is an interface expected to be built for this service:

~~~typescript
/**
 * Returns a list of reservations starting from a given time (or from
 * current time if omitted)
 *
 * @param {string} [date] - date to select reservations for, if not passed
 *                          current date is used
 * @param {string[]} [fields] - fields to select for reservations data list
 * @return {Promise<Reservation[]>} - list of found reservations
 */
public async list(date?: string, fields?: string[]): Promise<Reservation[]>;

/**
 * Fetches and returns single reservation record by its identifier
 *
 * @param {string} id - reservation identifier to fetch
 * @param {string[]} [fields] - fields to select for reservation data object
 * @return {Promise<Reservation|null>} - reservation data object or null if not found
 */
public async fetch(id: string, fields?: string[]): Promise<Partial<Reservation>|null>;

/**
 * Makes a given reservation or throws a proper error
 * if action is not possible
 *
 * @param {Reservation} reservation - reservation data structure
 * @param {string[]} [fields] - fields to select for updated reservations list
 * @return {Promise<Reservation[]>} - updated reservations list
 */
public async reserve(reservation: Reservation, fields?: string[]): Promise<Reservation[]>;

/**
 * Cancels reservation at a given time
 *
 * @param {string} id - reservation identifier
 * @param {string[]} [fields] - fields to select for updated reservations list
 * @return {Promise<Reservation[]>} - updated reservations list
 */
public async cancel(id: string, fields?: string[]): Promise<Reservation[]>;

 /**
 * Returns reservation time-table configuration settings
 *
 * @return {Promise<TimeTableOptions>} - reservations time-table options
 */
public async config(): Promise<TimeTableOptions>;
~~~

Where following complex types exposed as well:

`Reservation`:
 - id - reservation record identifier
 - carId - user car identifier
 - userId - user identifier
 - type - washing type selected for this reservation, one of `'fast'|'std'|'full'`
 - duration - is a range of start time/end time

`TimeTableOptions`:
 - start - washing station start working time in format HH:MM
 - end - washing station end working time in format HH:MM
 - baseTime - duration options for different types of washing, should be a list of
   ```typescript
   {
      key: 'fast'|'std'|'full', /* or whatever else... */
      title: string, /* human-readable definition title for washing type */
      duration: number, /* in minutes */
    }
    ```


**What to think about:** a) consider exposing sequelize model as a complex-type
of @imqueue service; b) consider options as a configurable database records
as well.

Any way, the [complete source code is available on GitHub](https://github.com/imqueue-sandbox/time-table)

Go to next chapter - [API Service. Integration](/tutorial/api-service)