import { Quad, Term } from "@rdfjs/types";
import { createTermNamespace, RDF } from "@treecg/types";
import { CBDShapeExtractor } from "extract-cbd-shape";
import jsonld from "jsonld";
import { NamedNode, Parser, Writer } from "n3";
import { Response } from "node-fetch";
import { RdfStore } from "rdf-stores";
import * as lens from "rdf-lens";
import { BasicLens, Cont } from "rdf-lens";
import { $INLINE_FILE } from "@ajuvercr/ts-transformer-inline-file";
import { cached } from "./utils";

export type Sensor = {
  id: Term;
  name: string;
  observes: string;
};

export type Location = {
  name: string;
  address: string;
  isPartOf?: Location;
  postal: string;
};

export type Node = {
  id: Term;
  name: string;
  description: string;
  related: string;
  devices: Device[];
  location: Location;
};

export type Device = {
  id: Term; // mumo:euid-bme680
  title: string; // ie bme680
  hasParts: Sensor[];
};

const SOSA = createTermNamespace("http://www.w3.org/ns/sosa/");
const quads_str = $INLINE_FILE("../sensor_shape.ttl");

export function get_shapes() {
  const quads = new Parser().parse(quads_str);
  const shapes = lens.extractShapes(quads);
  return shapes;
}

function filter(quads: Term[]): Term[] {
  return quads.filter((x, i, qs) => qs.findIndex((y) => x.equals(y)) == i);
}

const myFetch = async (
  alpha: Parameters<typeof fetch>[0],
  beta: Parameters<typeof fetch>[1],
) => {
  const resp = await fetch(alpha, beta);

  if (
    resp.headers
      .get("content-type")!
      .split(";")
      .map((x) => x.trim())
      .some((x) => x == "application/json")
  ) {
    const body = <Object>await resp.json();
    const nquads = await jsonld.toRDF(body, {
      format: "application/n-quads",
    });

    resp.headers.set("content-type", "application/n-quads");
    return new Response(nquads, resp);
  } else {
    return resp;
  }
};
const cachedFetch = cached(<typeof fetch>myFetch);

export async function extract<T>(
  json: string,
  shapeStore: RdfStore,
  lens: BasicLens<Cont, T>,
  bump?: (item: T, quads: Quad[]) => void,
  from_cache = false,
) {
  let quads: Quad[] = [];
  let usedCache = false;

  if (quads.length == 0) {
    const nquads = await jsonld.toRDF(JSON.parse(json), {
      format: "application/n-quads",
    });
    quads = new Parser().parse(nquads);
  }

  const subjects = filter(
    quads
      .filter(
        (x) =>
          x.predicate.equals(RDF.terms.type) &&
          x.object.equals(SOSA.custom("Platform")),
      )
      .map((x) => {
        return x.subject;
      }),
  ).filter((v, i, xs) => xs.findIndex((x) => x.equals(v)) == i);

  const extractor = new CBDShapeExtractor(shapeStore, undefined, {
    fetch: <typeof fetch>cachedFetch,
  });
  const store = RdfStore.createDefault();
  quads.forEach((quad) => store.addQuad(quad));

  for (let subj of subjects) {
    try {
      const quads = await extractor.extract(
        store,
        subj,
        new NamedNode("http://example.org/Shape"),
      );

      const relatedItems = quads.filter(
        (x) =>
          x.subject.equals(subj) &&
          x.predicate.value === "http://www.loc.gov/mods/rdf/v1#identifier",
      );
      for (let quad of relatedItems) {
        const cont = { quads, id: quad.subject };
        const item = lens.execute(cont);
        bump && bump(item, quads);
      }
    } catch (ex) {
      console.error("failed", ex);
    }
  }
}

