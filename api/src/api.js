const express = require('express');
const router = express.Router();
const request = require('request');

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
  var inputDir = req.body.inputDir;
  var accessToken = req.body.accessToken;
  var containerUrl = req.body.containerUrl;

  res.json({
    message: "success"
  });

  var fnName = `sm-mapfn-${process.env.COLUMBUS_USERNAME}`;

  async function createMapFns(mapfnUrl) {
    return new Promise(resolve => {
      var options = {
        url: "http://localhost:8080/create-map-functions",
        method: "POST",
        form: {
          imagePath: containerUrl,
          fnName: fnName,
          replicas: "2"
        }
      };
      request(options, function(err, res, body) {
        resolve(true);
      });
    });
  }

  async function ensureFnActive(fnName) {
    return new Promise(resolve => {
      (function waitForContainer() {
        var options = {
          url: `http://localhost:8080/fn-status?fnName=${fnName}`,
          method: "GET",
        };
        request(options, function(err, res, body) {
          if(JSON.parse(body).fnStatus === "Running") {
            resolve(true);
            console.log("container ready");
          } else {
            setTimeout(waitForContainer, 500);
          }
        });
      })();
    });
  }

  async function listCDriveItems(cDrivePath) {
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

  async function getDownloadUrl(cDrivePath) {
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

  async function mapToContainer(downloadUrl) {
    return new Promise(resolve => {
      var options = {
        url: `http://${fnName}/process/`,
        method: "POST",
        form: {
          downloadUrl: downloadUrl
        }
      };
      console.log("launch container fn");
      request(options, function(err, res, body) {
        resolve(JSON.parse(body).output);
      });
    });
  }

  createMapFns(containerUrl).then(() => {
    const promises = []
    promises.push(ensureFnActive(fnName));
    listCDriveItems(inputDir).then(tables => {
      console.log("list obtained");
      tables.forEach(dobj => {
        promises.push(getDownloadUrl(`${inputDir}/${dobj.name}`));
      });
      const oPromises = []
      Promise.all(promises).then(durls => {
        console.log("All durls obtained");
        console.log(durls[0]);
        durls.shift();
        console.log(durls[0]);
        durls.forEach(durl => {
          oPromises.push(mapToContainer(durl));
        });
        Promise.all(oPromises).then(values => {
          console.log(values.flat());
        });
      });
    });
  });
});

module.exports = router;
