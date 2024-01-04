import { NamedNode, Quad } from "@rdfjs/types";
import type { Stream, Writer } from "@ajuvercr/js-runner";
import { createTermNamespace, RDF, XSD } from "@treecg/types";
import * as N3 from "n3";

const { quad, literal, blankNode } = N3.DataFactory;

const qudt = createTermNamespace(
  "http://qudt.org/1.1/schema/qudt#",
  "unit",
  "numericValue",
  "QuantityValue",
);
const qudtUnit = createTermNamespace(
  "http://qudt.org/1.1/vocab/unit#",
  "DegreeCelsius",
);
const sosa = createTermNamespace(
  "https://www.w3.org/ns/sosa/",
  "Sensor",
  "observes",
  "madeBySensor",
);
const mumo = createTermNamespace("http://mumo.be/ns/");
const mumoData = createTermNamespace("http://mumo.be/data/");
const mumoMeting = createTermNamespace("http://mumo.be/data/");
const isotc = createTermNamespace(
  "http://def.isotc211.org/iso19156/2011/Observation#",
  "OM_Observation.resultTime",
  "OM_Observation.result",
  "OM_Observation",
);
const oslo = createTermNamespace(
  "https://data.vlaanderen.be/ns/observaties-en-metingen#",
);

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

const typeDict: { [key: string]: NamedNode } = {
  temperature: qudtUnit.DegreeCelsius,
};

function observation(data: Model, key: string) {
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
      mumoData.custom(`sensor/${key}/${device_id}`),
    ),
  );

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

function do_transform(input: string): string[] {
  const data: Model = JSON.parse(input);
  const strings: string[] = [];

  const types = ["temperature"];
  for (let ty of types) {
    try {
      if (data.uplink_message.decoded_payload[ty]) {
        const obj = observation(data, ty);
        if (obj) {
          const writer = new N3.Writer();
          strings.push(writer.quadsToString(obj));
        }
      }
    } catch (ex: any) {}
  }

  return strings;
}

export function transform(reader: Stream<string>, writer: Writer<string>) {
  reader.data(async (input) => {
    try {
      const objects = do_transform(input);
      for (let object of objects) {
        await writer.push(object);
      }
    } catch (e: any) {
      console.log(e);
    }
  });

  reader.on("end", writer.end);
}
