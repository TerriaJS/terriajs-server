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
