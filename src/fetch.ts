import { readFileSync, writeFileSync } from "fs";
import fetch, { Headers } from "node-fetch";
import type { Writer } from "@ajuvercr/js-runner";


interface Link {
  target: string;
  url: string;
}

function extract_links(headers: Headers): Link[] {
  // link = </ingest/?index=1514>; rel="next", </ingest/?index=1512>; rel="prev"
  const link = headers.get("link");
  if (!link) return [];

  const out: Link[] = [];

  for (let l of link.split(",")) {
    let [key, val] = l.split(";");
    if (!key || !val) continue;

    const url = key.trim().slice(1, -1);
    const [val_key, val_val] = val.split("=");

    if (!val_key || !val_val) continue;
    if (val_key.trim().toLowerCase() !== "rel") continue;
    const target = val_val.trim().slice(1, -1);

    out.push({ target, url });
  }

  return out;
}

async function findNextUrl(
  url: string,
  interval_ms: number,
  maybeLinks?: Link[],
): Promise<string> {
  const startingUrl = new URL(url);
  let links = !!maybeLinks
    ? maybeLinks
    : await fetch(url).then((resp) => extract_links(resp.headers));

  while (true) {
    const next = links.find((x) => x.target === "next");
    if (next) {
      // Found next url
      const url_url = new URL(
        next.url,
        `${startingUrl.protocol}//${startingUrl.host}`,
      );
      return url_url.href;
    }

    console.log("waiting");
    // Wait and refetch and look for headers
    await new Promise((res) => setTimeout(res, interval_ms));
    const resp = await fetch(url);
    links = extract_links(resp.headers);
  }
}

async function start(
  writer: Writer<string>,
  start_url: string,
  interval_ms: number,
  save_path?: string,
) {
  console.log("Start url", start_url);
  console.log("Save path", save_path);
  const save = (url: string) => {
    if (save_path) {
      writeFileSync(save_path, url, { encoding: "utf8" });
    }
  };

  let url = start_url;
  if (save_path) {
    try {
      url = readFileSync(save_path, { encoding: "utf8" });
      url = await findNextUrl(url, interval_ms);
    } catch (ex: any) {}
  }

  return async () => {
    console.log("Starting for real")
    while (true) {
      console.log("fetching url", url);
      const resp = await fetch(url);
      let links = extract_links(resp.headers);

      const text = await resp.text();
      console.log("got text!", text.length);

      await writer.push(text);
      // await new Promise(res => setTimeout(res, 1000))
      save(url);

      url = await findNextUrl(url, interval_ms, links);
    }
  };
}

export function fetcher(
  writer: Writer<string>,
  start_url: string,
  save_path?: string,
  interval_ms = 1000,
) {
  console.log("Starting fetcher");
  return start(writer, start_url, interval_ms, save_path);
}
