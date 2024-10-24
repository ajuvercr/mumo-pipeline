import { readFileSync, writeFileSync } from "fs";
import fetch, { Headers } from "node-fetch";
import { profiler, type Writer } from "@rdfc/js-runner";

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
    const target = val_val.trim().replaceAll('"', "");

    out.push({ target, url });
  }

  return out;
}

async function findNextUrl(
  url: string,
  interval_ms: number,
  stop: boolean,
  maybeLinks?: Link[],
): Promise<string | undefined> {
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

    if (stop) break;
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
  stop = false,
) {
  console.log("Start url", start_url);
  console.log("Save path", save_path);
  const save = (url: string) => {
    if (save_path) {
      writeFileSync(save_path, url, { encoding: "utf8" });
    }
  };

  let url: string | undefined = start_url;
  if (save_path) {
    try {
      url = readFileSync(save_path, { encoding: "utf8" });
      url = await findNextUrl(url, interval_ms, stop);
    } catch (ex: any) {}
  }

  return async () => {
    console.log("Starting for real");
    while (url) {
      console.log("fetching url", url);
      let ret = profiler.start("fetcher");
      const resp = await fetch(url);
      let links = extract_links(resp.headers);

      const text = await resp.text();
      // console.log("got text!", text.length);
      profiler.stop(ret);

      await writer.push(text);

      ret = profiler.start("fetcher");
      save(url);
      url = await findNextUrl(url, interval_ms, stop, links);
      profiler.stop(ret);
    }

    await writer.end();
  };
}

export function fetcher(
  writer: Writer<string>,
  start_url: string,
  save_path?: string,
  interval_ms = 1000,
  stop = false,
) {
  console.log("Starting fetcher");
  return start(writer, start_url, interval_ms, save_path, stop);
}
