import type { Writer } from "@rdfc/js-runner";
import * as N3 from "n3";
import { extract, get_shapes, Node } from "./sensors";
import { RdfStore } from "rdf-stores";
import { $INLINE_FILE } from "@ajuvercr/ts-transformer-inline-file";
import { BasicLens, Cont, Shapes } from "rdf-lens";
import { MeasurementGroup, SensorDevices, thisFetch } from "./utils";
import { Quad } from "@rdfjs/types";
import {
  createItem,
  sensor_device_payload,
  sensor_payload,
} from "./api/sensor";

export async function createNodeForNode(
  euid: string,
  model: MeasurementGroup[],
  nodes: Node[],
  fetch_f: typeof fetch,
  url: string,
): Promise<void> {
  const foundNode = nodes.find((x) => x.related === "euid");

  const sensorDevices: { [label: number]: any } = {};
  if (!foundNode) {
    console.log("No node found");
    const sensors: string[] = [];

    for (const group of model) {
      // then sensor channels
      for (const channel of group.measurements) {
        // Lets build some sensors, first sensor device
        let sensorDevice: string;
        if (sensorDevices[channel.deviceIndex]) {
          sensorDevice = sensorDevices[channel.deviceIndex];
        } else {
          const id = await createItem(
            sensor_device_payload({
              title: SensorDevices[channel.deviceIndex].name,
              publisher: SensorDevices[channel.deviceIndex].name,
              issued: new Date().toISOString(),
            }),
            url,
            fetch_f,
          );

          sensorDevices[channel.deviceIndex] = id;
          sensorDevice = id;

          for (const c of SensorDevices[channel.deviceIndex].channels) {
            const sensor = await createItem(
              sensor_payload({
                feature: "http://dbpedia.org/datatype/Temperature",
                identifier: "http://data.momu.be/items/id/" + euid + "-" + c,
                isPartOf: id,
                title: `${SensorDevices[channel.deviceIndex].name} - ${c}`,
              }),
              url,
              fetch_f,
            );

            sensors.push(sensor);
          }

          console.log("Built", id, sensors);
        }
      }
    }
  }
}

export function getShapes(): { store: RdfStore; shapes: Shapes } {
  // TODO: Change this so to use the provided nodes LDES or stay with this api, idrc
  const shape = $INLINE_FILE("../shape.ttl");
  
  const shapeTriples = new N3.Parser().parse(shape);
  const shapeStore = RdfStore.createDefault();
  shapeTriples.forEach((x) => shapeStore.addQuad(x));

  const shapes = get_shapes();
  console.log(shapes);
  return { store: shapeStore, shapes };
}

export type Nodes = { [related: string]: { node: Node; quads: Quad[] } };
export async function find_nodes(nodes: Nodes, from_cache = false) {
  const { store: shapeStore, shapes } = getShapes();
  const defaultQuads = new N3.Parser().parse(
    $INLINE_FILE("../default_node.ttl"),
  );
  const defaultNode = <Node>shapes.lenses["NodeShape"].execute({
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
    <BasicLens<Cont, Node>>shapes.lenses["NodeShape"],
    (node, quads) => {
      nodes[node.related] = { node, quads };
    },
    from_cache,
  );
}

export async function FetchNodes(writer: Writer<string>, period_ms = 5000) {
  return () => {
    setInterval(async () => {
      const nodes: Nodes = {};
      await find_nodes(nodes);

      for (const node of Object.values(nodes)) {
        await writer.push(new N3.Writer().quadsToString(node.quads));
      }
    }, period_ms);
  };
}
