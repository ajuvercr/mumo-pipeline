export = jsonld;
export as namespace jsonld;
declare namespace jsonld {
  function toRDF(
    document: Object,
    options: { format: "application/n-quads" },
  ): Promise<string>;
}

