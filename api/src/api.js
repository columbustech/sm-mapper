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

  var repInt = parseInt(replicas, 10);
  if (!(repInt>0 && repInt<=10)) {
    setStatus("error", "Replicas should be an integer between 1 and 10");
    return;
  }

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
    return new Promise((resolve, reject) => {
      (function waitForContainer() {
        var options = {
          url: `http://localhost:8080/fn-status?fnName=${fnName}`,
          method: "GET",
        };
        request(options, function(err, res, body) {
          var containerStatus = JSON.parse(body).fnStatus;
          if(containerStatus === "Running") {
            resolve(true);
          } else if (containerStatus === "Error") {
            setStatus("error", "Could not create map function containers").then(reject);
          } else {
            setTimeout(waitForContainer, 500);
          }
        });
      })();
    });
  }

  function listCDriveItems(cDrivePath) {
    return new Promise((resolve, reject) => {
      var options = {
        url: `${process.env.CDRIVE_API_URL}list-recursive/?path=${cDrivePath}`,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      };
      request(options, function(err, res, body) {
        if(err) {
          setStatus("error", err.toString()).then(reject);
          return;
        }
        if(res.statusCode !== 200) {
          setStatus("error", "Could not find input directory").then(reject);
          return;
        }
        var driveObjects = JSON.parse(body).driveObjects;
        if (driveObjects.length === 0) {
          setStatus("error", "No files inside input directory").then(reject);
        } else if (driveObjects.find(element => {
          return (element.type !== "File")
        })) {
          setStatus("error", "Input directory should only contain files").then(reject);
        } else {
          resolve(JSON.parse(body).driveObjects);
        }
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

  function setStatus(execStatus, msg) {
    return new Promise(resolve => {
      mongo.connect(mongoUrl, function(connectErr, client) {
        const db = client.db('mapper');
        const taskCollection = db.collection('mapfns');
        var updateDoc = {fnStatus: execStatus};
        if (msg) {
          updateDoc.message = msg;
        }
        taskCollection.updateOne({uid: uid}, {$set: updateDoc}, function(upErr, upRes) {
          client.close();
          resolve();
        });
      });
    });
  }

  function mapToContainer(inputFilePath) {
    return new Promise((resolve, reject) => {
      function processInput(attemptNo) {
        var options = {
          url: `http://${fnName}/process/`,
          method: "POST",
          form: {
            downloadUrl: `${process.env.CDRIVE_API_URL}download/?path=${inputFilePath}`,
            accessToken: accessToken
          }
        };
        request(options, function(err, res, body) {
          if (err) {
            console.log(`attemptNo :${attemptNo}, err: ${err}`);
            setTimeout(() => processInput(attemptNo + 1), 2000);
          } else if(res.statusCode !== 200) {
            console.log(`attemptNo :${attemptNo}, err: ${err}`);
            setTimeout(() => processInput(attemptNo + 1), 2000);
          } else {
            var output = JSON.parse(JSON.parse(body).output).map(tuple => {
              Object.keys(tuple).forEach(key => {
                if(typeof(tuple[key]) === "object") {
                  tuple[key] = JSON.stringify(tuple[key]);
                }
              });
              return tuple;
            });
            resolve(output);
          }
        });
      }
      processInput(1);
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

  function mapBatchToContainer(tablesBatch) {
    return new Promise(resolve => {
      const promises = [];
      tablesBatch.forEach(dobj => {
        promises.push(mapToContainer(`${inputDir}/${dobj.name}`));
      });                                                                                                               
      Promise.all(promises).then(values => {
        resolve(values.flat());
      });
    });                                                                                                               
  }

  createMapFns(containerUrl).then(() => {
    const p1 = ensureFnActive(fnName);
    const p2 = listCDriveItems(inputDir);
    Promise.all([p1,p2]).then(values => {
      var tables = values[1];
      var arr = Array.from({length: Math.ceil(tables.length/replicas)});

      var batches = arr.map((x,i) => {
        return tables.slice(i*replicas, (i+1)*replicas);
      });
      var mapBatches = Promise.resolve();
      var traits = [];
      batches.forEach(batch => {
        mapBatches = mapBatches.then(() => mapBatchToContainer(batch)).then(tuples => {
          traits = traits.concat(tuples);
        });
      });
      mapBatches.then(() => {
        deleteMapFns();
        saveLabels(traits, "/output.csv").then(() => uploadToCDrive("/output.csv", outputDir));
      });
    }, err => {
      deleteMapFns();
    });
  });
});

router.get('/status', function(req, res) {
  var uid = req.query.uid;
  mongo.connect(mongoUrl, function(connectErr, client) {
    const db = client.db('mapper');
    const collection = db.collection('mapfns');
    collection.findOne({uid: uid}, function(findErr, doc) {
      returnDoc = { fnStatus: doc.fnStatus };
      if (doc.message) {
        returnDoc.message = doc.message;
      }
      res.json(returnDoc);
    });
  });
});

module.exports = router;
