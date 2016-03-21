2.0.0

* Expect a server-specific configuration file, serverconfig.json, instead of one shared with the client.
* Move bypassProxyHosts option to that configuration file as bypassUpStreamProxyFor.
* Move upstreamProxy to config file.
* Rename proxyAuth.json to proxyauth.json
* Allow single line # comments in config files. 
* Add /proxyableDomains endpoint which returns JSON list of domains we can proxy for.

1.3.1

* Added `run_server.sh` and `stop_server.sh` scripts.
* Fixed a bug that would cause the server to crash if `config.json` was missing.

1.0.1

* Remove supervisor, as it wasn't doing anything useful and caused CPU and other issues.

1.0.0

* First stable release.
