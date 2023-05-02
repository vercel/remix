import { createSessionStorage } from "@remix-run/node";

import { createKvSessionStorageFactory } from "./sessions";

export const createKvSessionStorage =
  createKvSessionStorageFactory(createSessionStorage);
