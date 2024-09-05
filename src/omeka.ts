import { Factory, Item, OmekaConfig, OmekaTemplates } from "omeka-s-tools";
export const DeviceTemplateId = 31;
export const ChannelTemplateId = 30;
export const NodeTemplateId = 9;

export type OmekaNode = {
  "modsrdf:identifier": string; // devEUI
  "dcterms:title": string; // TTN Device ID,
  "sosa:hosts"?: Item<OmekaChannel>[] | Item<OmekaChannel>;
  "dcterms:hasPart"?: Item<OmekaDevice>[] | Item<OmekaDevice>; // physical mounted devices
  "dcterms:created": string;
  "dcterms:identifier": string;
  "cidoc:P55_has_current_location"?: string;
};
export type OmekaDevice = {
  "dcterms:title": string;
  "dcterms:publisher": string;
  "dcterms:issued": string;
};
export type OmekaChannel = {
  "dcterms:title": string;
  "dcterms:isPartOf": Item<OmekaDevice>;
  "dcterms:identifier": string;
  "mumo_generalfeaturemodel:GF_PropertyType.definition": string;
};

export type Omeka = {
  node: Factory<OmekaNode>;
  device: Factory<OmekaDevice>;
  channel: Factory<OmekaChannel>;
  templates: OmekaTemplates;
};

export async function getOmeka(url: string): Promise<Omeka> {
  const config = new OmekaConfig({
    api: url,
    key_identity: process.env.OMEKA_ID,
    key_credential: process.env.OMEKA_KEY,
  });
  const omeka = new OmekaTemplates(config);

  const nodeTemplate = await omeka.get_template(NodeTemplateId);
  const deviceTemplate = await omeka.get_template(DeviceTemplateId);
  const channelTemplate = await omeka.get_template(ChannelTemplateId);

  await omeka.preload_partial_templates();

  return {
    node: new Factory(nodeTemplate, config),
    device: new Factory(deviceTemplate, config),
    channel: new Factory(channelTemplate, config),
    templates: omeka,
  };
}
