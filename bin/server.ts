import * as http from "http";
import LinkHeader from "http-link-header";
import lmdb, { open } from "lmdb";
import commandLineArgs from "command-line-args";
import { Lock } from "async-await-mutex-lock";
import { readFile } from "fs/promises";

const dbDefinitions: commandLineArgs.OptionDefinition[] = [
  { name: "database", alias: "d", type: String, defaultValue: "my-db" },
  { name: "help", alias: "h", type: Boolean, defaultValue: false },
  { name: "command", type: String, defaultOption: true },
];

const serverDefinitions: commandLineArgs.OptionDefinition[] = [
  { name: "port", alias: "p", type: String, defaultValue: 3000 },
  { name: "key", alias: "k", type: String, defaultValue: "mumo-is-cool" },
  { name: "host", alias: "h", type: String, defaultValue: "127.0.0.1" },
];

const batchDefinitions: commandLineArgs.OptionDefinition[] = [
  { name: "file", alias: "f", type: String },
  { name: "start", alias: "s", type: Number, defaultValue: 0 },
];

const helpText = `
${process.argv[0]} ${process.argv[1]} [OPTION]
  server [SERVER_OPTIONS]   start the server
  batch [BATCH_OPTIONS]     seed the server from data.bin
  delete                    clear the database

[OPTION]
 --database, -d             location of the database folder (default my-db)
 --help, -h                 print this help message

[BATCH_OPTIONS]
 --file, -f                 location of the data file
 --start, -s                starting index (default 0)

[SERVER_OPTIONS]
 --host, -h                 host to bind server with (default 127.0.0.1)
 --key, -k                  secret key to use (default mumo-is-cool)
 --port, -p                 port to use (3000)
`;

class Instance {
  database: lmdb.Database;
  host: string = "127.0.0.1";
  port: number = 3000;
  lock: Lock<string>;

  constructor(options: { database: string }) {
    console.log("connecting with", options.database);
    this.database = open({
      path: options.database,
      // any options go here, we can turn on compression like this:
      compression: true,
    });
    this.lock = new Lock();
  }

  async ingest(str: string[]) {
    console.log("ingesting", str.length);
    let count = this.database.getCount();
    await this.database.batch(() => {
      for (const st of str) {
        this.database.put(count, st);
        count += 1;
      }
    });
  }

  async close() {
    await this.database.close();
  }

  async drop() {
    console.log("dropping database");
    await this.database.drop();
    await this.database.clearAsync();
  }

  async handlePost(request: http.IncomingMessage) {
    const content = await getBody(request);
    const count = this.database.getCount();
    await this.database.put(count, content);
  }

  handleGet(
    request: http.IncomingMessage,
    query: URLSearchParams,
  ): {
    body: Buffer;
    links: LinkHeader;
  } {
    const parts = (request.url ?? "").split("?");
    const p1 = parts[0];
    const p2 = new URLSearchParams(parts[1]);

    const indexKey = query.get("index");
    if (!indexKey) {
      throw "No index found";
    }
    const index = parseInt(indexKey);
    const content: Buffer | undefined = this.database.get(index);
    if (!content) {
      throw "No content found";
    }

    const createUri = (index: number) => {
      p2.set("index", index + "");
      return p1 + "?" + p2.toString();
    };

    const count = this.database.getCount();

    const links = new LinkHeader();
    links.set({ uri: createUri(0), rel: "first" });
    links.set({ uri: createUri(count - 1), rel: "last" });
    if (index > 0) {
      links.set({ uri: createUri(index - 1), rel: "prev" });
    }
    if (index < count - 1) {
      links.set({ uri: createUri(index + 1), rel: "next" });
    }

    return { body: content, links };
  }

  server(options: { key: string; host: string; port: number }) {
    this.host = options.host;
    this.port = options.port;
    const server = http.createServer(async (req, res) => {
      const query = new URLSearchParams((req.url ?? "").split("?")[1]);


      if (query.get("key") !== options.key) {
        res.writeHead(401, { "Content-Type": "text/plain" });
        res.end("Unauthorized");
        return;
      }

      if (req.method === "POST") {
        await this.lock.acquire();
        try {
          await this.handlePost(req);
        } catch (ex: unknown) {
          console.log(ex);
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end();
          return;
        } finally {
          this.lock.release();
        }

        res.writeHead(201, { "Content-Type": "text/plain" });
        res.end();
        return;
      }

      if (req.method === "GET") {
        let body: Buffer;
        let links: LinkHeader;
        // getting the body and links should be done in the mutex
        await this.lock.acquire();
        try {
          const get = this.handleGet(req, query);
          body = get.body;
          links = get.links;
        } catch (ex: unknown) {
          console.log(ex);
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end("Bad Request");
          return;
        } finally {
          this.lock.release();
        }

        // sending the request doesn't matter
        try {
          res.writeHead(200, { link: links.toString() });
          await new Promise((resolve, reject) =>
            res.write(body, (x) => {
              if (x) reject(x);
              else resolve({});
            }),
          );
          res.end();
        } catch (ex: unknown) {
          console.log(ex);
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end("Bad Request");
          return;
        }
      }
    });

    return server;
  }
}

function getBody(request: http.IncomingMessage) {
  return new Promise<Buffer>((res, rej) => {
    const chunks: Buffer[] = [];

    request.on("data", (chunk) => {
      chunks.push(chunk);
    });

    request.on("end", () => {
      res(Buffer.concat(chunks));
    });

    request.on("error", (error) => {
      rej(error);
    });
  });
}

async function main() {
  const options = commandLineArgs(dbDefinitions, {
    stopAtFirstUnknown: true,
  });

  if (options.help) {
    console.log(helpText);
    return;
  }

  const instance = new Instance(<{ database: string }>options);

  if (options.command === "delete") {
    await instance.drop();
    await instance.close();
    return;
  }

  if (options.command === "server") {
    const argv = options._unknown || [];
    const serverOptions = commandLineArgs(serverDefinitions, { argv });

    const server = instance.server(
      <Parameters<typeof instance.server>[0]>serverOptions,
    );

    server.listen(serverOptions.port, serverOptions.host, () => {
      console.log(
        "listening on",
        serverOptions.host + ":" + serverOptions.port,
      );
    });
    return;
  }

  if (options.command === "batch") {
    const argv = options._unknown || [];
    const batchOptions = commandLineArgs(batchDefinitions, { argv });

    const data = await readFile(batchOptions.file, { encoding: "utf8" });
    const slices = data
      .split("}{")
      .map((s, i, xs) =>
        i == 0 ? s + "}" : i == xs.length - 1 ? "{" + s : "{" + s + "}",
      )
      .filter((x, i) => {
        try {
          JSON.parse(x);
          return true;
        } catch (ex) {
          console.log(ex);
          console.log("index", i, x);
          return false;
        }
      });

    await instance.ingest(slices.slice(batchOptions.start));
    return;
  }

  console.log("Incorrect usage");
  console.log(helpText);
  process.exit(1);
}

main();
