if [ -f "terriajs.pid" ]; then
    pid=`cat "terriajs.pid"`
    echo "(Killing old server)."
    node -e "require('process').kill(${pid})"
else
    echo "TerriaJS server not running."
fi
