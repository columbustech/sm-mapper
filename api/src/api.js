const express = require('express');
const router = express.Router();
const request = require('request');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const fs = require('fs');
const mongo = require('mongodb').MongoClient;
const mongoUrl = 'mongodb://localhost:27017';

router.get('/specs', function(req, res) {
  res.json({
    clientId: process.env.COLUMBUS_CLIENT_ID,
    authUrl: process.env.AUTHENTICATION_URL,
    cdriveUrl: process.env.CDRIVE_URL,
    cdriveApiUrl: process.env.CDRIVE_API_URL,
    username: process.env.COLUMBUS_USERNAME
  });
});

router.post('/access-token', function(req, res) {
  var code = req.body.code;
  var redirect_uri = req.body.redirect_uri;

  const options = {
    url: `${process.env.AUTHENTICATION_URL}o/token/`,
    form: {
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: redirect_uri,
      client_id: process.env.COLUMBUS_CLIENT_ID,
      client_secret: process.env.COLUMBUS_CLIENT_SECRET
    }
  };

  var nestRes = request.post(options);
  nestRes.pipe(res);
});

router.post('/map', function(req, res) {
  var accessToken = req.body.accessToken;
  var inputDir = req.body.inputDir;
  var containerUrl = req.body.containerUrl;
  var outputDir = req.body.outputDir;
  var replicas = req.body.replicas;

  var uid = [...Array(10)].map(i=>(~~(Math.random()*36)).toString(36)).join('');


  var fnName = `mapfn-${process.env.COLUMBUS_USERNAME}-${uid}`;

  mongo.connect(mongoUrl, function(err, client) {
    const db = client.db('mapper');
    const collection = db.collection('mapfns');
    collection.insertOne({uid: uid, username: process.env.COLUMBUS_USERNAME, fnName: fnName, fnStatus: "executing"}, (insErr, insRes) => {
      res.json({
        uid: uid
      });
    });
  });

  function createMapFns(mapfnUrl) {
    return new Promise(resolve => {
      var options = {
        url: "http://localhost:8080/create-map-functions",
        method: "POST",
        form: {
          imagePath: containerUrl,
          fnName: fnName,
          replicas: replicas
        }
      };
      request(options, function(err, res, body) {
        resolve(true);
      });
    });
  }

  function ensureFnActive(fnName) {
    return new Promise(resolve => {
      (function waitForContainer() {
        var options = {
          url: `http://localhost:8080/fn-status?fnName=${fnName}`,
          method: "GET",
        };
        request(options, function(err, res, body) {
          if(JSON.parse(body).fnStatus === "Running") {
            resolve(true);
          } else {
            setTimeout(waitForContainer, 500);
          }
        });
      })();
    });
  }

  function listCDriveItems(cDrivePath) {
    return new Promise(resolve => {
      var options = {
        url: `${process.env.CDRIVE_API_URL}list-recursive/?path=${cDrivePath}`,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      };
      request(options, function(err, res, body) {
        resolve(JSON.parse(body).driveObjects);
      });
    });
  }

  function deleteMapFns(){
    var options = {
      url: "http://localhost:8080/delete-map-functions",
      method: "POST",
      form: {
        fnName: fnName
      }
    };
    request(options, function(err, res, body) {
    });
  }

  function mapToContainer(inputFilePath) {
    return new Promise(resolve => {
      var options = {
        url: `http://${fnName}/process/`,
        method: "POST",
        form: {
          downloadUrl: `${process.env.CDRIVE_API_URL}download/?path=${inputFilePath}`,
          accessToken: accessToken
        }
      };
      request(options, function(err, res, body) {
        var output = JSON.parse(JSON.parse(body).output).map(tuple => {
          Object.keys(tuple).forEach(key => {
            if(typeof(tuple[key]) === "object") {
              tuple[key] = JSON.stringify(tuple[key]);
            }
          });
          return tuple;
        });
        resolve(output);
      });
    });
  }

  function uploadComplete(uploadErr, uploadRes, uploadBody) {
    mongo.connect(mongoUrl, function(connectErr, client) {
      const db = client.db('mapper');
      const taskCollection = db.collection('mapfns');
      taskCollection.updateOne({uid: uid}, {$set: {fnStatus:"complete"}}, function(upErr, upRes) {
        client.close();
      });
    });
  }

  function uploadToCDrive(localPath, cDrivePath) {
    const uploadOptions = {
      url: `${process.env.CDRIVE_API_URL}upload/`,
      method: 'POST',
      formData: {
        path: cDrivePath,
        file: {
          value: fs.createReadStream(localPath),
          options: {
            filename: 'output.csv',
            contentType: 'text/csv'
          }
        }
      },
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    };
    request(uploadOptions, uploadComplete);
  }

  function saveLabels(results, localPath) {
    var header = Object.keys(results[0]).map(colName => ({id: colName, title: colName})); 
    const csvWriter = createCsvWriter({
      path: localPath,
      header: header
    });
    return csvWriter.writeRecords(results);
  }
  

  createMapFns(containerUrl).then(() => {
    const p1 = ensureFnActive(fnName);
    const p2 = listCDriveItems(inputDir);
    const promises = [];
    Promise.all([p1,p2]).then(values => {
      var tables = values[1];
      tables.forEach(dobj => {
        promises.push(mapToContainer(`${inputDir}/${dobj.name}`));
      });
      Promise.all(promises).then(values => {
        deleteMapFns();
        saveLabels(values.flat(), "/output.csv").then(() => uploadToCDrive("/output.csv", outputDir));
      });
    });
  });
});

router.get('/status', function(req, res) {
  var uid = req.query.uid;
  mongo.connect(mongoUrl, function(connectErr, client) {
    const db = client.db('mapper');
    const collection = db.collection('mapfns');
    collection.findOne({uid: uid}, function(findErr, doc) {
      res.json({
        fnStatus: doc.fnStatus
      });
    });
  });
});

module.exports = router;
