import { createTermNamespace } from "@treecg/types";

export const qudt = createTermNamespace(
  "http://qudt.org/1.1/schema/qudt#",
  "unit",
  "numericValue",
  "QuantityValue",
);

export const qudtUnit = createTermNamespace(
  "http://qudt.org/1.1/vocab/unit#",
  "DegreeCelsius",
  "RelHumidity",
  "Pressure",
  "Battery",
);

export const sosa = createTermNamespace(
  "http://www.w3.org/ns/sosa/",
  "Sensor",
  "observes",
  "madeBySensor",
  "hosts",
);

export const mumo = createTermNamespace("http://mumo.be/ns/");
export const mumoData = createTermNamespace("http://mumo.be/data/");
export const mumoMeting = createTermNamespace("http://mumo.be/data/");
export const isotc = createTermNamespace(
  "http://def.isotc211.org/iso19156/2011/Observation#",
  "OM_Observation.resultTime",
  "OM_Observation.result",
  "OM_Observation",
);

export const oslo = createTermNamespace(
  "https://data.vlaanderen.be/ns/observaties-en-metingen#",
);

