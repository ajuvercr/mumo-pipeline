import { NamedNode, Quad } from "@rdfjs/types";
import type { Stream, Writer } from "@ajuvercr/js-runner";
import { RDF, XSD } from "@treecg/types";
import * as N3 from "n3";
import { extract, get_shapes, Node, Sensor } from "./sensors";
import { RdfStore } from "rdf-stores";
import { isotc, mumoData, qudt, qudtUnit, sosa } from "./ontologies";
import path from "path";
import { readFile } from "fs/promises";

export type Nodes = { [related: string]: { node: Node; quads: Quad[] } };
const { quad, literal, blankNode } = N3.DataFactory;
type Model = {
  end_device_ids: {
    device_id: string;
    application_ids: {
      application_id: string;
    };
    dev_eui: string;
    dev_addr: string;
  };
  correlation_ids: string[];
  received_at: string;
  uplink_message: {
    f_port: number;
    f_cnt: number;
    frm_payload: string;
    decoded_payload: { version: number } & { [typ: string]: number };
    rx_metadata: {
      gateway_ids: {
        gateway_id: string;
        eui: string;
      };
      time: string;
      timestamp: number;
      rssi: number;
      channel_rssi: number;
      snr: number;
      uplink_token: string;
      received_at: string;
    }[];
    settings: {
      data_rate: {
        lora: {
          bandwidth: number;
          spreading_factor: number;
          coding_rate: string;
        };
      };
      frequency: string;
      timestamp: number;
      time: string;
    };
    received_at: string;
    consumed_airtime: string;
    network_ids: {
      net_id: string;
      tenant_id: string;
      cluster_id: string;
      cluster_address: string;
    };
  };
};

const alias: { [key: string]: string } = {
  Temperatuur: "temperature",
  Luchtvochtigheid: "humidity",
  temperature: "temperature",
  humidity: "humidity",
  battery: "battery",
  pressure: "pressure",
};

const typeDict: { [key: string]: NamedNode } = {
  temperature: qudtUnit.DegreeCelsius,
  battery: qudtUnit.Battery,
  humidity: qudtUnit.RelHumidity,
  pressure: qudtUnit.Pressure,
};

function observation(data: Model, key: string, sensor?: Sensor) {
  const time = data.uplink_message.rx_metadata[0].time;

  const subj = mumoData.custom(`${time}/${key}`);

  const device_id = data.end_device_ids.device_id;
  const value = data.uplink_message.decoded_payload[key];

  if (!time || !subj || !device_id || !value) {
    return;
  }

  const quads: Quad[] = [];
  const resultId = blankNode();

  quads.push(quad(subj, RDF.terms.type, isotc.OM_Observation));
  quads.push(
    quad(
      subj,
      isotc["OM_Observation.resultTime"],
      literal(time, XSD.terms.dateTime),
    ),
  );
  quads.push(quad(subj, isotc["OM_Observation.result"], resultId));
  quads.push(
    quad(
      subj,
      sosa.madeBySensor,
      sensor
        ? <N3.Quad_Object>sensor.id
        : mumoData.custom(`sensor/${device_id}/${key}`),
    ),
  );

  if (!sensor) {
    quads.push(
      quad(
        mumoData.custom(`sensor/${device_id}`),
        sosa.hosts,
        mumoData.custom(`sensor/${device_id}/${key}`),
      ),
    );
  }

  quads.push(quad(resultId, RDF.terms.type, qudt.QuantityValue));
  quads.push(quad(resultId, qudt.unit, typeDict[key]));
  quads.push(
    quad(
      resultId,
      qudt.numericValue,
      literal(value, XSD.terms.custom("float")),
    ),
  );

  return quads;
}

function do_transform(input: string, nodes: Nodes): string[] {
  const data: Model = JSON.parse(input);
  const strings: string[] = [];

  const node = nodes[data.end_device_ids.dev_eui] || nodes["default"];

  console.log("Found nodes", Object.keys(nodes));
  console.log("Current data", data.end_device_ids);

  const types = node
    ? node.node.hosts.map((x) => x.observes)
    : Object.keys(typeDict);

  console.log(
    "Found node",
    !!node,
    node?.node.hosts.map((x) => x.observes),
  );

  for (let thisTy of types) {
    const ty = alias[thisTy];
    try {
      if (data.uplink_message.decoded_payload[ty]) {
        const sensor = node?.node.hosts.find((x) => alias[x.observes] === ty);
        const obj = observation(data, ty, sensor);
        if (obj) {
          if (node) {
            obj.push(...node.quads);
          }
          const writer = new N3.Writer();
          const output = writer.quadsToString(obj);
          strings.push(output);
        }
      }
    } catch (ex: any) { }
  }

  return strings;
}

export function cached(fetch_f: typeof fetch): typeof fetch {
  const cache: {
    [id: string]: {
      status: number;
      text: string;
      headers: Headers;
    };
  } = {};
  return async (a, b) => {
    const c = cache[a.toString()];
    if (c) {
      console.log("Cached!");
      return new Response(c.text, {
        headers: c.headers,
        status: c.status,
      });
    }

    console.log("Fetching ", a.toString());
    const resp = await fetch_f(a, b);
    const text = resp.ok ? await resp.text() : "";
    const nc = {
      text,
      headers: resp.headers,
      status: resp.status,
    };
    cache[a.toString()] = nc;
    return new Response(nc.text, {
      headers: nc.headers,
      status: nc.status,
    });
  };
}

const thisFetch = cached(fetch);

export async function find_nodes(nodes: Nodes, from_cache = false) {
  const shape = await readFile(path.join(__dirname, "../shape.ttl"), {
    encoding: "utf8",
  });
  const shapeTriples = new N3.Parser().parse(shape);
  const shapeStore = RdfStore.createDefault();
  shapeTriples.forEach((x) => shapeStore.addQuad(x));

  const shapes = get_shapes();

  const defaultQuads = new N3.Parser().parse(
    await readFile(path.join(__dirname, "../default_node.ttl"), {
      encoding: "utf8",
    }),
  );
  const defaultNode = shapes.lenses["NodeShape"].execute({
    quads: defaultQuads,
    id: new N3.NamedNode("http://mumo.be/data/unknown/node"),
  });

  nodes["default"] = { node: defaultNode, quads: defaultQuads };

  const resp = await thisFetch(
    "https://heron.libis.be/momu/api/items?resource_template_id[]=21&resource_template_id[]=9",
  );
  const data = await resp.text();

  await extract<Node>(
    data,
    shapeStore,
    shapes.lenses["NodeShape"],
    (node, quads) => {
      nodes[node.related] = { node, quads };
    },
    from_cache,
  );
}

export async function transform(
  reader: Stream<string>,
  writer: Writer<string>,
) {
  const nodes: Nodes = {};
  await find_nodes(nodes);

  console.log(nodes);

  reader.data(async (input) => {
    try {
      const objects = do_transform(input, nodes);
      for (let object of objects) {
        await writer.push(object);
      }
    } catch (e: any) {
      console.log(e);
    }
  });

  reader.on("end", writer.end);
}
