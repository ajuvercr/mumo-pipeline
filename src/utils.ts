import { NamedNode } from "@rdfjs/types";
import { qudtUnit } from "./ontologies";
import { relative } from "path";

export type Payload1 = {
  [typ: string]: number;
};

export type Payload2 = {
  measurementGroups: MeasurementGroup[];
  payloadEncodingVersion: number;
};

export type Model = {
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
    decoded_payload: Payload1 | Payload2;
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

export const alias: { [key: string]: string } = {
  Temperatuur: "temperature",
  Luchtvochtigheid: "humidity",
  temperature: "temperature",
  humidity: "humidity",
  battery: "battery",
  pressure: "pressure",
};

export function getType(key: string): string {
  const fromDict = typeDict[key];
  if (fromDict) return fromDict.value;

  console.error("Did not find key", key);

  const keyCap = key.charAt(0).toUpperCase() + key.slice(1);

  return qudtUnit.custom(keyCap).value;
}
export const typeDict: { [key: string]: NamedNode } = {
  temperature: qudtUnit.DegreeCelsius,
  battery: qudtUnit.Battery,
  humidity: qudtUnit.RelHumidity,
  pressure: qudtUnit.Pressure,
  voltage: qudtUnit.custom("Voltage"),
};

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
export const thisFetch = cached(fetch);

export type Measurements = {
  measurementGroups: MeasurementGroup[];
  payloadEncodingVersion: number;
};

export type MeasurementGroup = {
  timestamp: number;
  measurements: Measurement[];
};

export type Measurement = {
  channelIndex: number;
  deviceIndex: number;
  value: number;
};

export const SensorDevices = [
  {
    name: "base",
    channels: ["temperature", "relativeHumidity", "pressure", "battery"],
  },
  { name: "mcu", channels: [] },
  {
    name: "battery",
    channels: ["voltage", "percentcharged"],
  },
  {
    name: "bme680",
    channels: ["temperature", "relativeHumidity", "pressure"],
  },
  {
    name: "tsl2591",
    channels: ["visibleLight"],
  },
  {
    name: "sht40",
    channels: ["temperature", "relativeHumidity"],
  },
  { name: "lis3dh", channels: [] },
  { name: "sths34", channels: [] },
  {
    name: "scd40",
    channels: ["temperature", "relativeHumidity", "C02"],
  },
  { name: "sps30", channels: [] },
  {
    name: "xa1110",
    channels: ["latitude", "longitude"],
  },
];
