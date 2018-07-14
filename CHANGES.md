### 2.7.3

* Proxy authentication can now optionally be specified with the `proxyAuth` key in the `--config-file`, as an alternative to `--proxy-auth`.

### 2.7.2

* When using `--proxy-auth` to automatically supply HTTP basic authentication credentials, and the remote server returns 403 (Forbidden), we now retry the request without the credentials. This will usually result in the server responding with a 401 (Unauthorized), causing the user's browser to prompt for credentials. This is useful when some of the resources on the server are not available with the automatic credentials but will work if more powerful credentials are supplied.

### 2.7.1

* Added support for server-supplied custom headers, by extending the process used to insert the basic http auth header `authorization`.
* Running with `--public false` now runs just a single server process, to support easier debugging.
* Improved validation of the Esri token configuration.
* Fixed a problem where a proxy error (such as an invalid content length) detected after the proxy had started sending the response would cause the worker to crash with an exception saying "Can't set headers after they are sent."
* Added `Strict-Transport-Security` to the list of response headers that are not passed through to the client by the proxy.

### 2.7.0

* Added esri-token-auth service which is able to request tokens from ESRI token servers with username / password authentication and forward them on to anonymous clients.

### 2.6.7

* Allow setting the size limit for proxy POST requests using `proxyPostSizeLimit` in the server config. If no unit is specified bytes is assumed, or use some reasonable unit like 'kb' for kilobytes or 'mb' for megabytes.

### 2.6.6

* Fixed a bug that caused `Content-Length: 0` to be included in proxied GET requests.

### 2.6.5

* No code changes, but fixes permissions on the run_server script which prevented it from starting (due to 2.6.4 being published from a Windows system, again).

### 2.6.4

* Made `npm stop` / `stop_server.sh` work on Windows systems.

### 2.6.3

* Don't let Express URL decode the path passed to the proxy service.

### 2.6.2

* No code changes, but fixes permissions on the run_server script which prevented it from starting (due to 2.6.1 being published from a Windows system).

### 2.6.1

* The `feedback` service now includes the Share URL for the current state of the map, if provided.

### 2.6.0

* Support HTTPS.
* Fix node engines specification in package.json.  terriajs-server requires at least node v4.0, but 5.x, 6.x, etc. are fine.

### 2.5.1

* Fix bug in finding the path of config files, which shows up under Node 6.

### 2.5.0

* Support AWS S3 as a share data (URL shortener) backend.
* Tweak behaviour of data provided by `/share` when behind proxies.
* v2.4.0 accidentally required NodeJS 5, when previously it worked on 0.10.  This version restores support back to NodeJS 4.

### 2.4.0

* Support `maxConversionSize` parameter to determine what sized files can be converted. Still defaults to 1MB.
* Remove warning message when no proxy auth file specified. (Still warn when it's specified but not available.)
* Support repeated command line parameters, such as `--port 3001 --port 4000`. The rightmost one wins.
* Enable 'strict' argument mode. This helps catch mistyped argument names.
* Support creating and resolving short URLs with different, prefixed providers.
* Provide /serverconfig endpoint to retrieve information about how the server is configured, including version.
* Config files (config.json and proxyauth.json) are now interpreted as JSON5, so they can include `//` and `/* */` comments.
* Deprecation warning: `#` comments in config files will be removed in version 3.
* With "--public false", now run just one CPU and don't restart on crashes, to facilitate development and testing.
* All API features are now being moved to `/api/v1` (eg `/api/v1/ping`). They are currently available also under `/ping` but will be removed.
* Verbose output and logging can be enabled with `--verbose`.
* Support `hostName` parameter in config file, to provide better URLs.

### 2.3.0

* The `feedback` service now includes the `User-Agent` header sent by the user's browser.
* Added support for requiring HTTP basic authentication on all requests by supplying something like the following in the server configuration file:

```
{
    "basicAuthentication": {
        "username": "myusername",
        "password": "mypassword"
    }
}
```

### 2.2.2

* Fixed a bug that caused the proxy to proxy any domain, even when given a whitelist.

### 2.2.1

* Add `trustProxy` setting to configuration file, which is passed through to Express.  See serverconfig.json.example.

### 2.2.0

* Add support for the `feedback` service.  See serverconfig.json.example for how to enable and configure it.

### 2.1.0

* Support "port" parameter in config file.

### 2.0.0

* Expect a server-specific configuration file, serverconfig.json, instead of one shared with the client.
* Move bypassProxyHosts option to that configuration file as bypassUpStreamProxyFor.
* Move upstreamProxy to config file.
* Rename proxyAuth.json to proxyauth.json
* Allow single line # comments in config files.
* Add /proxyableDomains endpoint which returns JSON list of domains we can proxy for.
* Allow catalog files outside your codebase to be specified using `initPaths: [...]`
* Config files are only looked for in the current directory, not in wwwroot or wwwroot/..

### 1.4.1

* Fixed a bug that caused all headers to be passed to the remote server by the proxy service, including headers that should be excluded.

### 1.4.0

* Added `run_server.sh` and `stop_server.sh` scripts.
* Fixed a bug that would cause the server to crash if `config.json` was missing.
* Added support for HTTP error code 500.

### 1.0.1

* Remove supervisor, as it wasn't doing anything useful and caused CPU and other issues.

### 1.0.0

* First stable release.
