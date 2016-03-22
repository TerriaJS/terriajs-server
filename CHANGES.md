2.0.0

* Expect a server-specific configuration file, serverconfig.json, instead of one shared with the client.
* Move bypassProxyHosts option to that configuration file as bypassUpStreamProxyFor.
* Move upstreamProxy to config file.
* Rename proxyAuth.json to proxyauth.json
* Allow single line # comments in config files. 
* Add /proxyableDomains endpoint which returns JSON list of domains we can proxy for.
* Allow catalog files outside your codebase to be specified using `initPaths: [...]`
* Config files are only looked for in the current directory, not in wwwroot or wwwroot/..

1.4.0

* Added `run_server.sh` and `stop_server.sh` scripts.
* Fixed a bug that would cause the server to crash if `config.json` was missing.
* Added support for HTTP error code 500.

1.0.1

* Remove supervisor, as it wasn't doing anything useful and caused CPU and other issues.

1.0.0

* First stable release.
