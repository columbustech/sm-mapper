const express = require('express');
const router = express.Router();
const request = require('request');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const fs = require('fs');

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

  res.json({
    message: "success"
  });

  var fnName = `sm-mapfn-${process.env.COLUMBUS_USERNAME}`;

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

  function getDownloadUrl(cDrivePath) {
    return new Promise(resolve => {
      var options = {
        url: `${process.env.CDRIVE_API_URL}download/?path=${cDrivePath}`,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      };
      request(options, function(err, res, body) {
        resolve(JSON.parse(body).download_url);
      });
    });
  }

  function mapToContainer(downloadUrl) {
    return new Promise(resolve => {
      var options = {
        url: `http://${fnName}/process/`,
        method: "POST",
        form: {
          downloadUrl: downloadUrl
        }
      };
      request(options, function(err, res, body) {
        resolve(JSON.parse(body).output);
      });
    });
  }

  function uploadComplete(uploadErr, uploadRes, uploadBody) {
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
    const promises = []
    promises.push(ensureFnActive(fnName));
    listCDriveItems(inputDir).then(tables => {
      tables.forEach(dobj => {
        promises.push(getDownloadUrl(`${inputDir}/${dobj.name}`));
      });
      const oPromises = []
      Promise.all(promises).then(durls => {
        durls.shift();
        durls.forEach(durl => {
          oPromises.push(mapToContainer(durl));
        });
        Promise.all(oPromises).then(values => {
          saveLabels(values.flat(), "/output.csv").then(() => uploadToCDrive("/output.csv", outputDir));
        });
      });
    });
  });
});

module.exports = router;
