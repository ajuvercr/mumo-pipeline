import { Quad } from "@rdfjs/types";
import type { Stream, Writer } from "@rdfc/js-runner";
import { getLogger, RDF, XSD } from "@treecg/types";
import * as N3 from "n3";
import { isotc, mumoData, qudt, sosa } from "./ontologies";
import {
  alias,
  getType,
  Model,
  Payload1,
  Payload2,
  SensorDevices,
} from "./utils";
import {
  getOmeka,
  NodeTemplateId,
  Omeka,
  OmekaChannel,
  OmekaDevice,
  OmekaNode,
} from "./omeka";
import { Item } from "omeka-s-tools";

const logger = getLogger("mumo-mapper");
const { quad, literal, blankNode, namedNode } = N3.DataFactory;

export async function setup_nodes(
  nodes: MyNodes,
  omeka: Omeka,
  item_set = 34332,
) {
  const items = await omeka.templates.get_items_set(item_set);
  const omeka_nodes = <Array<Item<OmekaNode>>>(
    items.filter((x) => x.factory.template.id === NodeTemplateId)
  );

  console.log("Got nodes, lets get some quads");
  for (const node of omeka_nodes) {
    const euid = node.item["modsrdf:identifier"];
    if (nodes[euid]) {
      nodes[euid].node = node;
    } else {
      nodes[euid] = { node };
    }
  }
}

function observation(
  value: number,
  time: number,
  sensor: Item<OmekaChannel>,
): Quad[] {
  const subj = mumoData.custom(
    `${time}/${sensor.item["dcterms:title"].replaceAll(" ", "")}`,
  );

  const quads: Quad[] = [];
  const resultId = blankNode();

  quads.push(quad(subj, RDF.terms.type, isotc.OM_Observation));
  quads.push(
    quad(
      subj,
      isotc["OM_Observation.resultTime"],
      literal(new Date(time).toISOString(), XSD.terms.dateTime),
    ),
  );
  quads.push(quad(subj, isotc["OM_Observation.result"], resultId));
  quads.push(quad(subj, sosa.madeBySensor, namedNode(sensor.id)));

  quads.push(quad(resultId, RDF.terms.type, qudt.QuantityValue));
  quads.push(
    quad(
      resultId,
      qudt.unit,
      namedNode(
        sensor.item["mumo_generalfeaturemodel:GF_PropertyType.definition"],
      ),
    ),
  );
  quads.push(
    quad(
      resultId,
      qudt.numericValue,
      literal(value, XSD.terms.custom("float")),
    ),
  );

  return quads;
}

export type MyNodes = {
  [euid: string]: {
    node: Item<OmekaNode>;
    quads?: Quad[];
  };
};

function asArray<T>(item: undefined | T | T[]): T[] {
  if (item === undefined) return [];

  if (Array.isArray(item)) return item;

  return [item];
}

class TransformInstance {
  private readonly euid: string;
  private readonly name: string;
  readonly item: MyNodes[string];
  private readonly omeka: Omeka;

  private constructor(
    name: string,
    euid: string,
    item: MyNodes[string],
    omeka: Omeka,
  ) {
    this.name = name;
    this.euid = euid;
    this.item = item;
    this.omeka = omeka;
  }

  static async build(
    euid: string,
    name: string,
    omeka: Omeka,
    nodes: MyNodes,
    ts: number | string,
  ): Promise<TransformInstance> {
    const item = nodes[euid];
    if (item) {
      logger.info("This euid has already been used " + euid);
      return new TransformInstance(name, euid, item, omeka);
    }

    logger.info("This euid has not been used yet " + euid);
    // This euid is not yet present
    // lets build one

    const created = new Date(ts).toISOString();
    const identifier = `http://data.momu.be/items/id/${euid}`;
    const node = await omeka.node.create(
      {
        "sosa:hosts": [],
        "dcterms:title": name,
        "dcterms:created": created,
        "dcterms:hasPart": [],
        "dcterms:identifier": identifier,
        "modsrdf:identifier": euid,
      },
      34332,
    );

    nodes[euid] = {
      node,
    };

    return new TransformInstance(name, euid, nodes[euid], omeka);
  }

  async get_device(deviceIdx: number, ts: number): Promise<Item<OmekaDevice>> {
    const deviceName = SensorDevices[deviceIdx].name;
    const foundDevice = asArray(this.item.node.item["dcterms:hasPart"]).find(
      (x) => x.item["dcterms:publisher"] == deviceName,
    );
    if (foundDevice) return foundDevice;

    logger.info(
      `Device ${deviceName} was not yet present for ${this.name} (${this.euid})`,
    );
    // We didn't find this device yet on this node
    // lets build one

    const title = `${this.name} - ${deviceName}`;
    const issued = new Date(ts).toISOString();
    const device = await this.omeka.device.create(
      {
        "dcterms:title": title,
        "dcterms:issued": issued,
        "dcterms:publisher": deviceName,
      },
      34332,
    );
    this.item.node.item["dcterms:hasPart"] = asArray(
      this.item.node.item["dcterms:hasPart"],
    );
    this.item.node.item["dcterms:hasPart"].push(device);
    await this.item.node.save();
    delete this.item.quads;

    return device;
  }

  async get_sensor(
    channelIdx: number,
    deviceIdx: number,
    ts: number,
  ): Promise<Item<OmekaChannel>> {
    const channelName = SensorDevices[deviceIdx].channels[channelIdx];
    console.log("channel name", channelName);
    const propertyType = getType(channelName);
    const thisDevice = await this.get_device(deviceIdx, ts);
    const thisDeviceIdx = thisDevice.idx;

    const foundChannel = asArray(this.item.node.item["sosa:hosts"]).find(
      (sensor) =>
        sensor.item["dcterms:isPartOf"].idx === thisDeviceIdx &&
        sensor.item["mumo_generalfeaturemodel:GF_PropertyType.definition"] ===
          propertyType,
    );
    if (foundChannel) return foundChannel;

    logger.info(
      `Channel ${channelName} (${
        SensorDevices[deviceIdx].name
      }) was not yet present for ${this.name} (${this.euid})`,
    );
    // We didn't find this channel yet on this device on this node
    // So let's build one

    const identifier = `http://data.momu.be/items/id/${this.euid}-${
      thisDevice.item["dcterms:publisher"]
    }-${channelName}`;
    const title = `${this.name} - ${
      thisDevice.item["dcterms:publisher"]
    } - ${channelName}`;
    const channel = await this.omeka.channel.create(
      {
        "dcterms:isPartOf": thisDevice,
        "mumo_generalfeaturemodel:GF_PropertyType.definition": propertyType,
        "dcterms:identifier": identifier,
        "dcterms:title": title,
      },
      34332,
    );
    this.item.node.item["sosa:hosts"] = asArray(
      this.item.node.item["sosa:hosts"],
    );
    this.item.node.item["sosa:hosts"].push(channel);
    await this.item.node.save();
    delete this.item.quads;

    return channel;
  }
}

function payload_is_new_version(
  payload: Payload1 | Payload2,
): payload is Payload2 {
  return (payload.payloadEncodingVersion || 0) > 16;
}

async function do_transform(
  input: string,
  nodes: MyNodes,
  omeka: Omeka,
): Promise<string[]> {
  const data: Model = JSON.parse(input);
  const strings: string[] = [];

  const instance = await TransformInstance.build(
    data.end_device_ids.dev_eui,
    data.end_device_ids.device_id,
    omeka,
    nodes,
    data.received_at,
  );
  const payload = data.uplink_message.decoded_payload;

  const dataPoints: {
    channel: Item<OmekaChannel>;
    time: number;
    value: number;
  }[] = [];

  if (payload_is_new_version(payload)) {
    for (const mg of payload.measurementGroups) {
      for (const g of mg.measurements) {
        console.log("Getting sensor", g.deviceIndex + 1, g.channelIndex);
        const channel = await instance.get_sensor(
          g.channelIndex,
          g.deviceIndex + 1,
          mg.timestamp,
        );
        dataPoints.push({ channel, time: mg.timestamp, value: g.value });
      }
    }
  } else {
    for (const key of Object.keys(payload)) {
      const valueIdx = SensorDevices[0].channels.indexOf(alias[key]);
      if (valueIdx >= 0) {
        console.log("Doing key", key, "with idx", valueIdx, payload[key]);
        const time = new Date(data.received_at).getTime();
        const channel = await instance.get_sensor(valueIdx, 0, time);
        dataPoints.push({
          channel,
          time,
          value: payload[key],
        });
      }
    }
  }

  for (const dp of dataPoints) {
    const obj = observation(dp.value, dp.time, dp.channel);
    if (instance.item.quads) {
      obj.push(...instance.item.quads);
    } else {
      const qs = await instance.item.node.getQuads(true, false);
      instance.item.quads = qs;
      obj.push(...qs);
    }

    const writer = new N3.Writer();
    const output = writer.quadsToString(obj);
    console.log("Quads", obj.length);
    strings.push(output);
  }

  return strings;
}

import * as dotenv from "dotenv";
dotenv.config({ path: ".env" });
export async function transform(
  reader: Stream<string>,
  writer: Writer<string>,
) {
  const nodes: MyNodes = {};
  const omeka = await getOmeka("https://heron.libis.be/momu-test/api");
  // await find_nodes(nodes);
  await setup_nodes(nodes, omeka);
  setInterval(() => setup_nodes(nodes, omeka), 60000);
  console.log("EUids", Object.keys(nodes));

  reader.data(async (input) => {
    try {
      const objects = await do_transform(input, nodes, omeka);
      for (let object of objects) {
        console.log(object);
        await writer.push(object);
      }
    } catch (e: any) {
      console.log(e);
    }
  });

  reader.on("end", writer.end);
}
