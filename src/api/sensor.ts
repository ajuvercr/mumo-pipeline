export type SensorDevice = {
  title: string;
  publisher: string;
  issued: string;
};
export function sensor_device_payload(device: SensorDevice): string {
  const payload = {
    "@context": "https://heron.libis.be/momu-test/api-context",
    "@type": ["o:Item"],
    "o:resource_class": {
      "o:id": 32,
    },
    "o:resource_template": {
      "o:id": 31,
    },
    "o:item_set": [34042],
    "dcterms:title": [
      {
        property_id: 1,
        "@value": device.title,
        type: "literal",
      },
    ],
    "dcterms:publisher": [
      {
        property_id: 5,
        type: "literal",
        "@value": device.publisher,
      },
    ],
    "dcterms:issued": [
      {
        property_id: 23,
        type: "literal",
        "@value": device.issued,
      },
    ],
  };
  return JSON.stringify(payload);
}

export type Sensor = {
  title: string;
  isPartOf: string;
  identifier: string;
  feature: string;
};
export function sensor_payload(device: Sensor): string {
  const isPartOfIds = device.isPartOf.split("/");
  const payload = {
    "@context": "https://heron.libis.be/momu-test/api-context",
    "@type": ["o:Item", "sosa:Sensor"],
    "o:resource_class": {
      "o:id": 525,
    },
    "o:resource_template": {
      "o:id": 30,
    },
    "o:item_set": [34042],
    "dcterms:title": [
      {
        property_id: 1,
        "@value": device.title,
        type: "literal",
      },
    ],
    isPartOf: [
      {
        property_id: 33,
        type: "resource:item",
        "@id": device.isPartOf,
        value_resource_id: isPartOfIds[isPartOfIds.length - 1],
        value_resource_name: "items",
      },
    ],
    identifier: [
      {
        property_id: 10,
        type: "literal",
        "@value": device.identifier,
      },
    ],
    feature: [
      {
        property_id: 1648,
        type: "uri",
        "@id": device.feature,
      },
    ],
  };
  return JSON.stringify(payload);
}

export async function createItem(
  payload: string,
  url: string,
  fetch_f: typeof fetch,
): Promise<string> {
  console.log("Payload");
  console.log(payload);
  const resp = await fetch_f(url, {
    body: payload,
    method: "POST",
    headers: { "Content-Type": "application/ld+json" },
  });
  console.log("Resp", resp.status, resp.statusText, resp.headers);
  const json = <{ [label: string]: any }>await resp.json();
  console.log("Got me some id", json["@id"]);
  return json["@id"];
}
