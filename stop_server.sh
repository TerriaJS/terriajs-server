if [ -f "$(dirname $0)/terriajs.pid" ]; then
    pid=`cat "$(dirname $0)/terriajs.pid"`
    ps | grep "^ *${pid}" > /dev/null
    running=$?
    if [ $running -eq 0 ]; then
        echo "(Killing old server)."
        kill $pid
    fi
    rm "$(dirname $0)/terriajs.pid"
else
    echo "TerriaJS server not running."
fi