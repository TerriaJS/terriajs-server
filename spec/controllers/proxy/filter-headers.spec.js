const {
  filterHeaders
} = require("../../../lib/controllers/proxy/filter-headers");

describe("proxy filterHeaders", () => {
  const headers = {
    "Proxy-Connection": "delete me!",
    unfilteredheader: "don't delete me!"
  };
  it("properly filters", () => {
    const filteredHeaders = filterHeaders(headers);
    expect(filteredHeaders["Proxy-Connection"]).toBeUndefined();
    expect(filteredHeaders.unfilteredheader).toBe(headers.unfilteredheader);
  });

  xit("properly filters when socket defined", () => {
    const socket = { remoteAddress: "test" };
    const filteredHeaders = filterHeaders(headers, socket);
    expect(filteredHeaders["x-forwarded-for"]).toBe(socket.remoteAddress);
  });

  xit("properly combines x-forwarded-for header with socket remote address", () => {
    const socket = { remoteAddress: "test" };
    headers["x-forwarded-for"] = "x-forwarded-for";
    const filteredHeaders = filterHeaders(headers, socket);
    expect(filteredHeaders["x-forwarded-for"]).toBe(
      `${headers["x-forwarded-for"]}, ${socket.remoteAddress}`
    );
  });
});
