import { createCookie } from "@remix-run/node";

import { createKvSessionStorage } from "../implementations";

function createKv() {
  let values = new Map<string, string>();
  let get = jest.fn(async <TData>(key: string): Promise<TData | null> => {
    let value = values.get(key);
    return value === undefined ? null : (JSON.parse(value) as TData);
  });

  return {
    values,
    client: {
      exists: jest.fn(async (key: string) => (values.has(key) ? 1 : 0)),
      del: jest.fn(async (key: string) => (values.delete(key) ? 1 : 0)),
      get,
      set: jest.fn(async (key: string, value: string) => {
        values.set(key, value);
        return "OK";
      }),
    },
  };
}

function cookieValue(setCookie: string) {
  return setCookie.split(";", 1)[0];
}

describe("createKvSessionStorage", () => {
  it("preserves the session lifecycle for adapter-generated ids", async () => {
    let kv = createKv();
    let storage = createKvSessionStorage({
      kv: kv.client,
      cookie: { name: "__session" },
      prefix: "custom.prefix",
    });

    let session = await storage.getSession();
    session.set("user", "first");
    let cookie = cookieValue(await storage.commitSession(session));
    let id = await createCookie("__session").parse(cookie);

    expect(id).toMatch(/^custom\.prefix:[0-9a-f]{16}$/);
    expect(kv.values.get(id)).toBe(JSON.stringify({ user: "first" }));

    let restored = await storage.getSession(cookie);
    expect(restored.get("user")).toBe("first");
    restored.set("user", "updated");
    await storage.commitSession(restored);
    expect(kv.values.get(id)).toBe(JSON.stringify({ user: "updated" }));

    await storage.destroySession(restored);
    expect(kv.values.has(id)).toBe(false);
  });

  it("does not access unrelated keys referenced by an unsigned cookie", async () => {
    let kv = createKv();
    let unrelatedKey = "application:private-data";
    kv.values.set(unrelatedKey, JSON.stringify({ private: true }));
    let cookie = createCookie("__session");
    let forgedCookie = cookieValue(await cookie.serialize(unrelatedKey));
    let storage = createKvSessionStorage({ kv: kv.client, cookie });

    let session = await storage.getSession(forgedCookie);
    expect(session.data).toEqual({});
    expect(kv.client.get).not.toHaveBeenCalled();

    session.set("private", false);
    await storage.commitSession(session);
    expect(kv.client.set).not.toHaveBeenCalled();

    await storage.destroySession(session);
    expect(kv.client.del).not.toHaveBeenCalled();
    expect(kv.values.get(unrelatedKey)).toBe(JSON.stringify({ private: true }));
  });

  it("only accepts ids from the configured namespace", async () => {
    let kv = createKv();
    let unrelatedKey = "session:0123456789abcdef";
    kv.values.set(unrelatedKey, JSON.stringify({ private: true }));
    let cookie = createCookie("__session");
    let forgedCookie = cookieValue(await cookie.serialize(unrelatedKey));
    let storage = createKvSessionStorage({
      kv: kv.client,
      cookie,
      prefix: "custom.prefix",
    });

    let session = await storage.getSession(forgedCookie);
    session.set("private", false);
    await storage.commitSession(session);
    await storage.destroySession(session);

    expect(kv.client.get).not.toHaveBeenCalled();
    expect(kv.client.set).not.toHaveBeenCalled();
    expect(kv.client.del).not.toHaveBeenCalled();
    expect(kv.values.get(unrelatedKey)).toBe(JSON.stringify({ private: true }));
  });
});
