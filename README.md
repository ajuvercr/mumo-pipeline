# Mumo Pipeline

## Pipeline

This pipeline constructs a LDES for Mumo sensor values, and consists of multiple components:

- **MumoFetch** interacts with "https://mumo.ilabt.imec.be/ingest/?key=some-key&index=0", a simple webserver reexposing  the incoming messages from the things network.
- **MumoMapper** maps the incoming messages to linked data objects according the OSLO application profile.
- **Sdsify** maps the linked data objects to SDS records.
- **Bucketizer** will bucketize the SDS records based on the sensor that created that measurement.
- **Ingest** will ingest the SDS bucketized SDS records into mongo.

The ingestion pipeline is only ingests members into a database, actually exposing a LDES requires the ldes-solid-server.


## Usage

Install packages
```bash
npm install
npm run build
```


Run pipeline
```bash
npx js-runner pipline.ttl
# or
npm start
```
