const {
  executeWithRetry
} = require("../../../lib/controllers/proxy/execute-with-retry");

describe("executeWithRetry", () => {
  it("should succeed on first attempt with matching auth", async () => {
    const mockFetch = jasmine.createSpy().and.returnValue(
      Promise.resolve({
        statusCode: 200,
        headers: {},
        body: { pipe: jasmine.createSpy() }
      })
    );

    const strategies = [
      { type: "user", authorization: "Bearer token" },
      { type: "none" }
    ];
    const requestOptions = { url: "http://example.com" };

    const result = await executeWithRetry({
      strategies,
      requestOptions,
      fetchFn: mockFetch
    });

    expect(result.statusCode).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("should retry with next strategy on 401, and return on first success response", async () => {
    const mockFetch = jasmine.createSpy().and.returnValues(
      Promise.resolve({
        statusCode: 401,
        body: { dump: jasmine.createSpy().and.returnValue(Promise.resolve()) }
      }),
      Promise.resolve({
        statusCode: 200,
        headers: {},
        body: { pipe: jasmine.createSpy() }
      })
    );

    const strategies = [
      { type: "user", authorization: "Bearer wrong" },
      { type: "proxy", authorization: "Bearer correct" },
      { type: "none" }
    ];

    const result = await executeWithRetry({
      strategies,
      requestOptions: { url: "http://example.com" },
      fetchFn: mockFetch
    });

    expect(result.statusCode).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("should retry with next strategy on 401, and wait for first success response", async () => {
    const mockFetch = jasmine.createSpy().and.returnValues(
      Promise.resolve({
        statusCode: 401,
        body: { dump: jasmine.createSpy().and.returnValue(Promise.resolve()) }
      }),
      Promise.resolve({
        statusCode: 403,
        body: { dump: jasmine.createSpy().and.returnValue(Promise.resolve()) }
      }),
      Promise.resolve({
        statusCode: 200,
        headers: {},
        body: { pipe: jasmine.createSpy() }
      })
    );

    const strategies = [
      { type: "user", authorization: "Bearer wrong" },
      { type: "proxy", authorization: "Bearer also-wrong" },
      { type: "none" }
    ];

    const result = await executeWithRetry({
      strategies,
      requestOptions: { url: "http://example.com" },
      fetchFn: mockFetch
    });

    expect(result.statusCode).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("should stop retrying after last strategy", async () => {
    const mockFetch = jasmine.createSpy().and.returnValue(
      Promise.resolve({
        statusCode: 403,
        body: { dump: jasmine.createSpy().and.returnValue(Promise.resolve()) }
      })
    );

    const strategies = [
      { type: "user", authorization: "Bearer wrong" },
      { type: "proxy", authorization: "Bearer also-wrong" },
      { type: "none" }
    ];

    const result = await executeWithRetry({
      strategies,
      requestOptions: { url: "http://example.com" },
      fetchFn: mockFetch
    });

    expect(result.statusCode).toBe(403);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("should throw error if no strategies provided", async () => {
    const mockFetch = jasmine.createSpy();

    const strategies = [];
    await expectAsync(
      executeWithRetry({
        strategies,
        requestOptions: { url: "http://example.com" },
        fetchFn: mockFetch
      })
    ).toBeRejectedWithError("No auth strategies provided");
  });

  describe("body.dump() error handling", () => {
    it("should continue retry even if body.dump() throws an error", async () => {
      const dumpError = new Error("Stream already consumed");
      const mockFetch = jasmine.createSpy().and.returnValues(
        Promise.resolve({
          statusCode: 401,
          body: {
            dump: jasmine.createSpy().and.returnValue(Promise.reject(dumpError)) // dump() fails!
          }
        }),
        Promise.resolve({
          statusCode: 200,
          headers: {},
          body: { pipe: jasmine.createSpy() }
        })
      );

      const strategies = [
        { type: "user", authorization: "Bearer wrong" },
        { type: "proxy", authorization: "Bearer correct" }
      ];

      // Should NOT throw, should retry and succeed
      const result = await executeWithRetry({
        strategies,
        requestOptions: { url: "http://example.com" },
        fetchFn: mockFetch
      });

      expect(result.statusCode).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should handle multiple body.dump() failures and still succeed", async () => {
      const dumpError = new Error("Cannot dump consumed body");
      const mockFetch = jasmine.createSpy().and.returnValues(
        Promise.resolve({
          statusCode: 401,
          body: {
            dump: jasmine.createSpy().and.returnValue(Promise.reject(dumpError))
          }
        }),
        Promise.resolve({
          statusCode: 403,
          body: {
            dump: jasmine.createSpy().and.returnValue(Promise.reject(dumpError))
          }
        }),
        Promise.resolve({
          statusCode: 200,
          headers: {},
          body: { pipe: jasmine.createSpy() }
        })
      );

      const strategies = [
        { type: "user", authorization: "Bearer wrong1" },
        { type: "proxy", authorization: "Bearer wrong2" },
        { type: "none" }
      ];

      const result = await executeWithRetry({
        strategies,
        requestOptions: { url: "http://example.com" },
        fetchFn: mockFetch
      });

      expect(result.statusCode).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("should handle body.dump() timeout errors gracefully", async () => {
      const timeoutError = new Error("Timeout waiting for body");
      timeoutError.code = "ETIMEDOUT";

      const mockFetch = jasmine.createSpy().and.returnValues(
        Promise.resolve({
          statusCode: 401,
          body: {
            dump: jasmine
              .createSpy()
              .and.returnValue(Promise.reject(timeoutError))
          }
        }),
        Promise.resolve({
          statusCode: 200,
          headers: {},
          body: { pipe: jasmine.createSpy() }
        })
      );

      const strategies = [
        { type: "user", authorization: "Bearer wrong" },
        { type: "none" }
      ];

      const result = await executeWithRetry({
        strategies,
        requestOptions: { url: "http://example.com" },
        fetchFn: mockFetch
      });

      expect(result.statusCode).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should handle synchronous dump() errors", async () => {
      const mockFetch = jasmine.createSpy().and.returnValues(
        Promise.resolve({
          statusCode: 401,
          body: {
            dump: jasmine.createSpy().and.throwError("Synchronous error")
          }
        }),
        Promise.resolve({
          statusCode: 200,
          headers: {},
          body: { pipe: jasmine.createSpy() }
        })
      );

      const strategies = [
        { type: "user", authorization: "Bearer wrong" },
        { type: "none" }
      ];

      const result = await executeWithRetry({
        strategies,
        requestOptions: { url: "http://example.com" },
        fetchFn: mockFetch
      });

      expect(result.statusCode).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should fail if all strategies fail AND body.dump() fails", async () => {
      const dumpError = new Error("Cannot dump body");
      const mockFetch = jasmine.createSpy().and.returnValues(
        Promise.resolve({
          statusCode: 401,
          body: {
            dump: jasmine.createSpy().and.returnValue(Promise.reject(dumpError))
          }
        }),
        Promise.resolve({
          statusCode: 403,
          body: {
            dump: jasmine.createSpy().and.returnValue(Promise.reject(dumpError))
          }
        }),
        Promise.resolve({
          statusCode: 401,
          body: { dump: jasmine.createSpy() }
        })
      );

      const strategies = [
        { type: "user", authorization: "Bearer wrong1" },
        { type: "proxy", authorization: "Bearer wrong2" },
        { type: "none" }
      ];

      const result = await executeWithRetry({
        strategies,
        requestOptions: { url: "http://example.com" },
        fetchFn: mockFetch
      });

      // Should return the last failed response
      expect(result.statusCode).toBe(401);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });
});
