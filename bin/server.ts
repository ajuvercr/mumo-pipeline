import * as http from "http";
import LinkHeader from "http-link-header";
import commandLineArgs from "command-line-args";
import { Lock } from "async-await-mutex-lock";
import { createReadStream } from "fs";

import { Kafka, Producer } from "kafkajs";
import { writeFile } from "fs/promises";
import { PROV } from "@treecg/types";

const dbDefinitions: commandLineArgs.OptionDefinition[] = [
  {
    name: "kafka",
    alias: "k",
    type: String,
    defaultValue: "127.0.0.1:9092",
    multiple: true,
  },
  { name: "topic", alias: "t", type: String, defaultValue: "mumo" },
  { name: "group", alias: "g", type: String, defaultValue: "reading-group" },
  { name: "clientId", alias: "c", type: String, defaultValue: "my-client" },
  { name: "help", alias: "h", type: Boolean, defaultValue: false },
  { name: "command", type: String, defaultOption: true },
];

const serverDefinitions: commandLineArgs.OptionDefinition[] = [
  { name: "file", alias: "f", type: String },
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
  log                       log messages in kafka topic

[OPTION]
 --kafka, -k                kafka endpoint (default 127.0.0.1:9092)
 --group, -p                kafka group (default reading-group)
 --topic, -t                kafka topic (default mumo)
 --help, -h                 print this help message

[BATCH_OPTIONS]
 --file, -f                 location of the data file
 --start, -s                starting index (default 0)

[SERVER_OPTIONS]
 --file, -f                 location of datafile to write to
 --host, -h                 host to bind server with (default 127.0.0.1)
 --key, -k                  secret key to use (default mumo-is-cool)
 --port, -p                 port to use (default 3000)
`;

class Instance {
  kafka: Kafka;
  producer: Producer;
  topic: string;
  host: string = "127.0.0.1";
  port: number = 3000;
  group: string;
  lock: Lock<string>;

  constructor(options: {
    kafka: string[];
    topic: string;
    clientId: string;
    group: string;
  }) {
    console.log(options, options);
    this.kafka = new Kafka({
      clientId: options.clientId,
      brokers: options.kafka,
    });
    this.producer = this.kafka.producer({ allowAutoTopicCreation: true });
    this.topic = options.topic;
    this.group = options.group;
    this.lock = new Lock();
  }

  async init() {
    await this.producer.connect();
  }

  async log_messages() {
    // await this.reset();
    const consumer = this.kafka.consumer({
      groupId: this.group + Math.random(),
    });
    // Consuming
    await consumer.connect();
    await consumer.subscribe({ topic: this.topic, fromBeginning: true });
    const gropu = await consumer.describeGroup();
    console.log(gropu);

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        console.log({
          partition,
          offset: message.offset,
          value: message.value!.toString(),
        });
      },
    });

    // await consumer.disconnect();
  }

  async ingest(str: string[]) {
    // lets first clear it
    console.log("ingesting", str.length);
    let i = 0;
    const step = 100;

    while (i < str.length) {
      console.log("at", i, str.length);
      await this.producer.send({
        topic: this.topic,
        messages: str.slice(i, i + step).map((value) => ({ value })),
      });

      i = i + step;
    }
  }

  async close() {
    await this.producer.disconnect();
  }

  async reset() {
    const admin = this.kafka.admin();
    await admin.resetOffsets({
      groupId: this.group,
      topic: this.topic,
      earliest: true,
    });
    await admin.disconnect();
  }

  async drop() {
    const admin = this.kafka.admin();
    const topics = await admin.listTopics();
    if (topics.find((x) => x === this.topic)) {
      console.log("deleting topic", this.topic);
      await admin.deleteTopics({ topics: [this.topic] });
    } else {
      console.log("topic not found");
    }
    await admin.disconnect();
  }

  async handlePost(request: http.IncomingMessage, file: string) {
    const content = await getBody(request);
    await writeFile(file, content, { encoding: "utf8", flag: "a+" });
    await this.producer.send({
      topic: this.topic,
      messages: [{ value: content }],
    });
  }

  handleGet(): {
    body: Buffer;
    links: LinkHeader;
  } {
    throw "we don't do get";
  }

  server(options: { key: string; host: string; port: number; file: string }) {
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
          await this.handlePost(req, options.file);
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
          const get = this.handleGet();
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

  const instance = new Instance(
    <ConstructorParameters<typeof Instance>[0]>options,
  );
  await instance.init();

  if (options.command === "delete") {
    await instance.drop();
    console.log("dropped");
    await instance.close();
    console.log("closed");
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
    const data = await readFileChunks(batchOptions.file);
    const slices = data.filter((x, i) => {
      try {
        JSON.parse(x);
        return true;
      } catch (ex) {
        console.log("error at index", i, x);
        return false;
      }
    });

    await instance.ingest(slices.slice(batchOptions.start));
    await instance.close();
    return;
  }

  if (options.command === "log") {
    await instance.log_messages();
    await instance.close();
    return;
  }

  console.log("Incorrect usage");
  console.log(helpText);
  process.exit(1);
}

function readFileChunks(location: string): Promise<string[]> {
  return new Promise((res, rej) => {
    const out: string[] = [];
    let last = "";
    const stream = createReadStream(location, { encoding: "utf8" });
    stream.on("data", (incoming: string) => {
      const s = last + incoming;
      let pos = 0;
      let idx = s.indexOf("}{", pos);
      while (idx >= 0) {
        out.push(s.slice(pos, idx + 1));
        pos = idx + 1;
        idx = s.indexOf("}{", pos);
      }
      last = s.slice(pos);
    });
    stream.on("error", rej);
    stream.on("end", () => {
      if (last) {
        out.push(last);
      }
      res(out);
    });
  });
}

main();
