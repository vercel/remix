import type {
  CreateSessionStorageFunction,
  SessionData,
  SessionIdStorageStrategy,
} from "@remix-run/server-runtime";

interface KvClient {
  exists: (key: string) => Promise<number>;
  del: (key: string) => Promise<number>;
  get: <TData>(key: string) => Promise<TData | null>;
  set: (
    key: string,
    value: string,
    opts?: { pxat?: any; nx?: any }
  ) => Promise<string | null>;
}

export interface KvSessionStorageOptions {
  /**
   * KV client from the `@vercel/kv` package.
   */
  kv: KvClient;

  /**
   * The Cookie used to store the session id on the client, or options used
   * to automatically create one.
   */
  cookie: SessionIdStorageStrategy["cookie"];

  /**
   * Prefix of the Redis key name used for session data, followed by `:${id}`.
   * @default "session".
   */
  prefix?: string;
}

const genRanHex = (size: number) =>
  Array.from({ length: size }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join("");

export const createKvSessionStorageFactory = (
  createSessionStorage: CreateSessionStorageFunction
) => {
  return <Data = SessionData, FlashData = Data>({
    kv,
    cookie,
    prefix = "session",
  }: KvSessionStorageOptions) => {
    type S = SessionIdStorageStrategy<Data, FlashData>;

    let createData: S["createData"] = async (data, expires) => {
      while (true) {
        let baseId = genRanHex(16);
        let id = `${prefix}:${baseId}`;
        if ((await kv.exists(id)) === 0) {
          let str = JSON.stringify(data);
          if (expires) {
            await kv.set(id, str, { pxat: expires.getTime() });
          } else {
            await kv.set(id, str);
          }
          return id;
        }
      }
    };

    let readData: S["readData"] = async (id) => {
      return (await kv.get(id)) ?? null;
    };

    let updateData: S["updateData"] = async (id, data, expires) => {
      let str = JSON.stringify(data);
      if (str === "{}") {
        // If the data is empty then delete the session key
        return deleteData(id);
      }
      if (expires) {
        await kv.set(id, str, { pxat: expires.getTime() });
      } else {
        await kv.set(id, str);
      }
    };

    let deleteData: S["deleteData"] = async (id) => {
      await kv.del(id);
    };

    return createSessionStorage<Data, FlashData>({
      cookie,
      createData,
      readData,
      updateData,
      deleteData,
    });
  };
};
