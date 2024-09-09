import { Writer } from "@rdfc/js-runner";
import { MyNodes, setup_nodes } from "./mapper";
import { getOmeka, Omeka } from "./omeka";
import { Writer as N3Writer } from "n3";

async function once(
  nodes: MyNodes,
  omeka: Omeka,
  writer: Writer<string>,
  interval: number,
) {
  while (true) {
    console.log("Getting nodes");
    await setup_nodes(nodes, omeka);
    for (const node of Object.values(nodes)) {
      const quads = await node.node.getQuads(true, false);
      const quads_str = new N3Writer().quadsToString(quads);
      console.log(" ===== Found Node =====");
      console.log(quads_str);
      await writer.push(quads_str);
    }

    await new Promise((res) => setTimeout(res, interval));
  }
}

export async function source(
  writer: Writer<string>,
  interval: number = 60000,
  api: string = "https://heron.libis.be/momu-test/api",
) {
  const nodes: MyNodes = {};
  const omeka = await getOmeka(api);

  return () => {
    once(nodes, omeka, writer, interval);
  };
}
