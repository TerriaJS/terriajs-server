#!/bin/bash
if [ -f "/etc/init.d/varnish" ]; then
    sudo /etc/init.d/varnish restart
fi
if [ -f "$(dirname $0)/terriajs.pid" ]; then
    echo "Warning: server seems to be already running."
fi
date > output.log

if [ "`which nohup`" == "" ]; then
    # There's no nohup on Windows. We just run node without it, which is fine in a dev environment.
    node $(dirname "$0")/lib/app.js "$@" >> output.log 2> error.log < /dev/null &
else
    nohup node $(dirname "$0")/lib/app.js "$@" >> output.log 2> error.log < /dev/null &
fi
sleep 2 # Give the server a chance to fail.
cat output.log
pid=$!
ps | grep "^ *${pid}" > /dev/null
running=$?
if [ $running -eq 0 ]; then
    echo "(TerriaJS-Server running in background with pid $!)." && echo $pid > "$(dirname $0)/terriajs.pid"
else
    cat error.log
fi
