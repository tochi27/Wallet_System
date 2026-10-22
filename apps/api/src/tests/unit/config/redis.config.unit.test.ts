// The queues' connection is built from REDIS_URL when the module loads, so each case loads it fresh
const connectionFor = (url: string) => {
  let connection!: Record<string, unknown>;
  jest.isolateModules(() => {
    jest.doMock("../../../config/env", () => ({ env: { REDIS_URL: url } }));
    connection = require("../../../config/redis.config").bullmqConnection;
  });
  return connection;
};

describe("bullmqConnection", () => {
  it("connects to a plain local Redis", () => {
    expect(connectionFor("redis://localhost:6379")).toEqual({ host: "localhost", port: 6379 });
  });

  it("selects the database number in the URL, like the main client", () => {
    expect(connectionFor("redis://localhost:6379/1")).toMatchObject({ db: 1 });
  });

  it("uses an encrypted connection for rediss://, with the password", () => {
    expect(connectionFor("rediss://default:s3cr%40t@redis-123.cloud.example.com:16379")).toEqual({
      host: "redis-123.cloud.example.com",
      port: 16379,
      tls: { servername: "redis-123.cloud.example.com" },
      password: "s3cr@t",
    });
  });

  it("passes a non-default username", () => {
    expect(connectionFor("redis://app:pw@redis.example.com:6379")).toMatchObject({ username: "app", password: "pw" });
  });
});
