#!/bin/bash
if [ -z "$1" ]; then
  echo "Usage: $0 <port>"
  exit 1
fi
PORT=$1
PID=$(lsof -t -i:$PORT)
if [ -z "$PID" ]; then
  echo "No process running on port $PORT"
else
  kill -9 $PID
  echo "Killed process $PID on port $PORT"
fi
