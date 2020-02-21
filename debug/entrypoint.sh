#!/bin/bash
mkdir -p /storage/public/
cp -r /ui/build/* /storage/public/
/go/container-manager/container-manager &
node /api/src/server.js &
mkdir -p /storage/data
mongod --dbpath /storage/data &
service nginx start
