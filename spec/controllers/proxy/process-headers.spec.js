import { processHeaders } from "../../../lib/controllers/proxy/process-headers.js";

describe("proxy processHeaders", () => {
  it("properly set headers", () => {
    const headers = {
      "Proxy-Connection": "delete me!",
      unfilteredheader: "don't delete me!"
    };

    const result = processHeaders(headers, 1200);
    expect(result["Proxy-Connection"]).toBeUndefined();
    expect(result.unfilteredheader).toBe(headers.unfilteredheader);
    expect(result["cache-control"]).toBe("public,max-age=1200");
    expect(result["access-control-allow-origin"]).toBe("*");
  });

  it("strips Set-Cookie headers from upstream responses", () => {
    const headers = {
      "Set-cookie": "session=abc123; Path=/; HttpOnly",
      "content-type": "application/json"
    };

    const result = processHeaders(headers, 1200);
    expect(result["Set-cookie"]).toBeUndefined();
    expect(result["content-type"]).toBe("application/json");
  });

  it("don't set duration when undefined", () => {
    const headers = {
      "Proxy-Connection": "delete me!",
      unfilteredheader: "don't delete me!"
    };

    const result = processHeaders(headers, undefined);
    expect(result["Proxy-Connection"]).toBeUndefined();
    expect(result.unfilteredheader).toBe(headers.unfilteredheader);
    expect(result["cache-control"]).toBeUndefined();
    expect(result["access-control-allow-origin"]).toBe("*");
  });
});
